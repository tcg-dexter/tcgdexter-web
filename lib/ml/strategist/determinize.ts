// Give the ghost opponent real cards.
//
// `buildGhostState` fills every opponent hidden zone with anonymous
// placeholders. For the template planner that is harmless — its search never
// resolves an opponent action, it just scores a settled board. For a ROLLOUT
// it is fatal in a specific and one-sided way: a placeholder hand plays no
// Supporter, a placeholder deck searches up nothing, so the simulated
// opponent can only attack with whatever is already in play. Every one of our
// candidate moves is then priced against an opponent who cannot answer it,
// and the estimate is biased toward whatever looks good against a passive
// board — which is exactly the greedy, under-developed play the route planner
// already lost with.
//
// So the opponent's hidden zones are DETERMINIZED: sampled from the meta
// prior's posterior over what they are playing, given what they have revealed.
// This is standard Perfect Information Monte Carlo, and it is the point at
// which metaPrior.ts stops being eight feature columns and starts being the
// thing that decides what the simulated opponent can do.
//
// WHAT THIS IS NOT
//
// It is not a hidden-information leak. Nothing here reads the real opponent's
// hand or deck. The input is `view.opponent.discard` plus their board — the
// same public information a human reads — run through a prior built from the
// published meta. A human who sees Zorua and says "they have Zoroark, expect
// 250 next turn" is doing this, less precisely.

import { lookupCard } from "@/lib/engine/catalog";
import { mulberry32, type Rng } from "@/lib/engine/sim";
import type { PlayerView } from "@/lib/engine/sim";
import type { CardInstance, GameState } from "@/lib/engine/types";
import { expectedUnseen, topArchetypes } from "@/lib/ml/features/metaPrior";
import { isCurrentStandard } from "@/lib/engine/catalog";

/** Everything the opponent has shown us: board (with evolution stacks) and
 *  discard. Prizes and hand are unknown by definition and contribute nothing. */
export function revealedOpponentCards(view: PlayerView): string[] {
  const out: string[] = [];
  const mons = [view.opponent.board.active, ...view.opponent.board.bench];
  for (const mon of mons) {
    if (!mon) continue;
    out.push(mon.card.name);
    for (const c of mon.stack) out.push(c.name);
    for (const c of mon.attachedTools) out.push(c.name);
    for (const c of mon.attachedEnergy) out.push(c.name);
  }
  for (const c of view.opponent.discard) out.push(c.name);
  return out.filter((n) => n && n !== "(unknown)");
}

export interface DeterminizeResult {
  /** Archetype the sample was drawn for, and its posterior probability. */
  archetype: string | null;
  confidence: number;
  /** Named cards placed into the opponent's hand. */
  handNamed: number;
  /** Named cards placed into the opponent's deck. */
  deckNamed: number;
}

/** Everything a side has shown, read straight off a GameState. The
 *  PlayerView form above is what a live policy has; this is what a
 *  log-reconstructed state has, and they must agree. */
export function revealedSideCards(state: GameState, side: "player" | "opponent"): string[] {
  const s = state.sides[side];
  const out: string[] = [];
  for (const mon of [s.active, ...s.bench]) {
    if (!mon) continue;
    out.push(mon.card.name);
    for (const c of mon.stack) out.push(c.name);
    for (const c of mon.attachedTools) out.push(c.name);
    for (const c of mon.attachedEnergy) out.push(c.name);
  }
  for (const c of s.discard) out.push(c.name);
  return out.filter((n) => n && n !== "(unknown)");
}

/**
 * Replace the ghost opponent's placeholder hand and deck with a sample from
 * the meta prior. Mutates `ghost` in place and returns what it did, so a
 * caller can report coverage rather than assume it.
 *
 * `rng` is threaded so a determinization is reproducible from a seed — a
 * rollout that cannot be replayed cannot be debugged.
 */
export function determinizeOpponent(
  ghost: GameState,
  view: PlayerView,
  rng: Rng,
): DeterminizeResult {
  return determinizeSide(ghost, "opponent", revealedOpponentCards(view), rng, {
    handCount: ghost.sides.opponent.hand.length,
    deckCount: ghost.sides.opponent.deck.length,
  });
}

/**
 * Determinize a side of a state reconstructed from a battle LOG.
 *
 * A log replay knows only what surfaced: the opponent's deck array is
 * typically empty and their hand is a few placeholders. Rolling forward from
 * that hands them an instant deck-out and makes every one of our candidate
 * moves look like a win — a silent, total loss of discrimination that would
 * still print a confident regret. So the zone SIZES are rebuilt from 60-card
 * conservation and then filled from the prior.
 */
export function determinizeLogSide(
  state: GameState,
  side: "player" | "opponent",
  rng: Rng,
  handFloor = 5,
): DeterminizeResult {
  const s = state.sides[side];
  const inPlay = [s.active, ...s.bench]
    .filter((m) => m != null)
    .reduce(
      (n, m) => n + 1 + m!.stack.length + m!.attachedEnergy.length + m!.attachedTools.length,
      0,
    );
  const handCount = Math.max(s.hand.length, handFloor);
  const accounted =
    handCount + s.discard.length + s.lostZone.length + s.prizes.length + inPlay;
  const deckCount = Math.max(0, Math.min(60, 60 - accounted));
  return determinizeSide(state, side, revealedSideCards(state, side), rng, {
    handCount,
    deckCount,
  });
}

function determinizeSide(
  state: GameState,
  which: "player" | "opponent",
  revealed: string[],
  rng: Rng,
  sizes: { handCount: number; deckCount: number },
): DeterminizeResult {
  const top = topArchetypes(revealed, 1);
  const archetype = top.length > 0 ? top[0].id : null;
  const confidence = top.length > 0 ? top[0].p : 0;
  const ghost = state;
  const target = which;

  const handCount = sizes.handCount;
  const deckCount = sizes.deckCount;
  const needed = handCount + deckCount;
  if (needed === 0) {
    return { archetype, confidence, handNamed: 0, deckNamed: 0 };
  }

  // Draw a multiset of plausible remaining cards, weighted by expected
  // copies. Ask for generously more names than slots so the sample is not
  // ten copies of one card.
  const expected = expectedUnseen(revealed, 60).filter(
    (e) => e.qty > 0 && isCurrentStandard(e.name),
  );
  const pool: string[] = [];
  for (const { name, qty } of expected) {
    // Round up: a card the posterior expects 0.4 copies of is still a card
    // this deck can hold, and rounding it away would empty a low-confidence
    // sample entirely.
    for (let i = 0; i < Math.max(1, Math.round(qty)); i++) pool.push(name);
  }
  if (pool.length === 0) {
    return { archetype, confidence, handNamed: 0, deckNamed: 0 };
  }

  const draw = (): CardInstance | null => {
    const name = pool[Math.floor(rng() * pool.length)];
    const catalog = lookupCard(name);
    // A name the catalog cannot resolve would enter play as an inert card and
    // quietly weaken the simulated opponent — the same silent-degradation
    // shape as the anonymous ghost deck. Skip it and leave the placeholder.
    if (!catalog) return null;
    return { id: `det-${Math.floor(rng() * 1e9).toString(36)}`, name, catalog };
  };

  // Resize as well as fill: a log-reconstructed side can have an empty deck
  // array, and leaving it empty is an instant deck-out loss in every rollout.
  const hand = ghost.sides[target].hand;
  const deck = ghost.sides[target].deck;
  let handNamed = 0;
  for (let i = 0; i < handCount; i++) {
    const card = draw();
    if (card) {
      hand[i] = card;
      handNamed += 1;
    } else if (i >= hand.length) {
      hand[i] = { id: `det-pad-${i}`, name: "(unknown)", catalog: null };
    }
  }
  hand.length = handCount;
  let deckNamed = 0;
  for (let i = 0; i < deckCount; i++) {
    const card = draw();
    if (card) {
      deck[i] = card;
      deckNamed += 1;
    } else if (i >= deck.length) {
      deck[i] = { id: `det-pad-d${i}`, name: "(unknown)", catalog: null };
    }
  }
  deck.length = deckCount;

  return { archetype, confidence, handNamed, deckNamed };
}

/** Convenience: a determinization rng derived from a seed and a sample index,
 *  so sample k of one decision is reproducible and independent of sample k of
 *  another. */
export function determinizeRng(seed: number, sample: number): Rng {
  return mulberry32((seed ^ (sample * 0x9e3779b9)) >>> 0);
}
