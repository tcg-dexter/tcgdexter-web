// Replay → PlayerView bridge — lets the board-aware value model score real
// imported battle logs, not just simulated games.
//
// The replay engine (lib/engine/replay.ts) and the simulator share the same
// GameState shape, so viewFor() structurally works on replay snapshots.
// What it does NOT give us for free:
//
//   * CATALOG HYDRATION. The replay reducer creates every CardInstance with
//     `catalog: null` (reducer.ts makeCard) and never hydrates it. Twenty of
//     the value model's features are catalog-derived (max_hp, energy_units,
//     can_attack, hand composition, …) and would silently encode as 0 —
//     the model would "see" a board of 0-HP mons with no attacks. Hydration
//     via lookupCard() is the first thing this module does.
//   * DECK COUNTS. Replay decks start EMPTY (the reducer learns cards as
//     they surface), so `deck.length` is meaningless. We estimate by
//     60-card conservation: 60 − everything visibly accounted for.
//   * unseenOwn. Synthesized from the player's saved deck list (importing a
//     log requires a saved_deck_id) minus every card seen in their zones.
//   * PER-TURN FLAGS. retreat/stadium-this-turn live in the sim's
//     TurnContext, not GameState; recovered from the turn's parsed actions.
//
// Perspective: views are always built for the PLAYER side (the log owner) —
// the opponent's hand contents and deck list are unknown, so opponent-side
// views would be systematically degraded. The curve therefore reads as
// "the log owner's win probability" at every point.

import type { BattleLogParseResult, ParsedTurn } from "@/lib/battle-log/types";
import type {
  CardInstance,
  GameState,
  PlayerSide,
  PokemonInPlay,
  ReplayResult,
} from "@/lib/engine/types";
import type { PlayerView } from "@/lib/engine/sim/view";
import { viewFor } from "@/lib/engine/sim/view";
import { lookupCard } from "@/lib/engine/catalog";
import { parseDeckListCards } from "@/lib/cardPrinting";

export interface ReplayTurnView {
  /** Global 1-indexed turn number from the parsed log. */
  turn_number: number;
  /** Whose turn this was. */
  actor: "player" | "opponent";
  /** The log owner's information set at the END of this turn. */
  view: PlayerView;
}

export interface ReplayViewsResult {
  views: ReplayTurnView[];
  /** Share of distinct card names (both sides' visible zones, final state)
   *  that resolved against the catalog. Below ~0.7 the value curve should
   *  not be trusted — unresolved cards encode as inert 0-HP blanks. */
  cardCoverage: number;
}

/* ─── Catalog hydration ─────────────────────────────────────────── */

function hydrateCard(card: CardInstance): void {
  if (card.catalog === null && card.name && !card.unrevealed) {
    card.catalog = lookupCard(card.name);
  }
}

function hydrateMon(mon: PokemonInPlay | null): void {
  if (!mon) return;
  hydrateCard(mon.card);
  for (const c of mon.stack) hydrateCard(c);
  for (const c of mon.attachedEnergy) hydrateCard(c);
  for (const c of mon.attachedTools) hydrateCard(c);
}

function hydrateSide(side: PlayerSide): void {
  for (const c of side.hand) hydrateCard(c);
  for (const c of side.discard) hydrateCard(c);
  for (const c of side.lostZone) hydrateCard(c);
  for (const c of side.deck) hydrateCard(c);
  hydrateMon(side.active);
  for (const mon of side.bench) hydrateMon(mon);
}

/** Resolve catalog pointers throughout a snapshot, in place. Snapshots are
 *  structuredClone-d per action by the reducer, so mutation is contained. */
export function hydrateState(state: GameState): void {
  hydrateSide(state.sides.player);
  hydrateSide(state.sides.opponent);
  if (state.stadium) hydrateCard(state.stadium.card);
}

/* ─── Deck-count estimate ───────────────────────────────────────── */

function monCardCount(mon: PokemonInPlay | null): number {
  if (!mon) return 0;
  return 1 + mon.stack.length + mon.attachedEnergy.length + mon.attachedTools.length;
}

/** 60-card conservation: deck ≈ 60 − hand − discard − lost zone − prizes
 *  remaining − every card in play. Clamped to [0, 60]. */
function estimateDeckCount(side: PlayerSide): number {
  const visible =
    side.hand.length +
    side.discard.length +
    side.lostZone.length +
    side.prizes.length +
    monCardCount(side.active) +
    side.bench.reduce((s, m) => s + monCardCount(m), 0);
  return Math.max(0, Math.min(60, 60 - visible));
}

/* ─── unseenOwn synthesis ───────────────────────────────────────── */

/** Card-name counts from the saved deck list text, or null if unparsable. */
function deckListCounts(deckList: string | null): Map<string, number> | null {
  if (!deckList) return null;
  try {
    const counts = new Map<string, number>();
    for (const entry of parseDeckListCards(deckList)) {
      counts.set(entry.name, (counts.get(entry.name) ?? 0) + entry.qty);
    }
    return counts.size > 0 ? counts : null;
  } catch {
    return null;
  }
}

/** Perfect-memory inference over a real log: full 60-list minus every card
 *  the owner has SEEN of their own (hand + board + discard + lost zone).
 *  What remains is deck ∪ prizes composition — the same contract as the
 *  sim's unseenOwnCounts. */
function unseenFromDeckList(
  listCounts: Map<string, number>,
  side: PlayerSide,
): Record<string, number> {
  const seen = new Map<string, number>();
  const see = (name: string) => seen.set(name, (seen.get(name) ?? 0) + 1);
  for (const c of side.hand) see(c.name);
  for (const c of side.discard) see(c.name);
  for (const c of side.lostZone) see(c.name);
  const seeMon = (mon: PokemonInPlay | null) => {
    if (!mon) return;
    see(mon.card.name);
    for (const c of mon.stack) see(c.name);
    for (const c of mon.attachedEnergy) see(c.name);
    for (const c of mon.attachedTools) see(c.name);
  };
  seeMon(side.active);
  for (const mon of side.bench) seeMon(mon);

  const unseen: Record<string, number> = {};
  listCounts.forEach((count, name) => {
    const remaining = count - (seen.get(name) ?? 0);
    if (remaining > 0) unseen[name] = remaining;
  });
  return unseen;
}

/* ─── Card coverage ─────────────────────────────────────────────── */

function coverageOf(state: GameState): number {
  const names = new Set<string>();
  const collect = (cards: CardInstance[]) => {
    for (const c of cards) if (c.name && !c.unrevealed) names.add(c.name);
  };
  const collectMon = (mon: PokemonInPlay | null) => {
    if (!mon) return;
    names.add(mon.card.name);
    collect(mon.stack);
    collect(mon.attachedEnergy);
    collect(mon.attachedTools);
  };
  for (const side of [state.sides.player, state.sides.opponent]) {
    collect(side.hand);
    collect(side.discard);
    collect(side.lostZone);
    collectMon(side.active);
    for (const mon of side.bench) collectMon(mon);
  }
  if (names.size === 0) return 0;
  let resolved = 0;
  names.forEach((name) => {
    if (lookupCard(name)) resolved += 1;
  });
  return resolved / names.size;
}

/* ─── Main fold ─────────────────────────────────────────────────── */

/**
 * One PlayerView per playable turn (the log owner's information set at the
 * turn's end state), ready for encodeStateFeatures / the value model.
 *
 * `deckList` is the owner's saved deck list text (from saved_decks); pass
 * null when unavailable — unseenOwn then degrades to a single "(unknown)"
 * bucket sized by the deck+prize estimate, which keeps `unseen_total`
 * roughly right while the category splits go to 0.
 */
export function replayTurnViews(
  parsed: BattleLogParseResult,
  replayResult: ReplayResult,
  deckList: string | null,
): ReplayViewsResult {
  const { states, initialState } = replayResult;
  if (states.length !== parsed.actions.length) {
    throw new Error(
      `replay snapshots (${states.length}) do not match actions (${parsed.actions.length}); ` +
        "run replay() with keepSnapshots enabled on the same parse result",
    );
  }

  const listCounts = deckListCounts(deckList);

  const playableTurns = parsed.turns.filter(
    (t): t is ParsedTurn & { actor: "player" | "opponent" } =>
      t.phase === "turn" && (t.actor === "player" || t.actor === "opponent"),
  );

  const views: ReplayTurnView[] = [];
  for (const turn of playableTurns) {
    const indices = turn.action_indices;
    if (indices.length === 0) continue;
    const endState = states[indices[indices.length - 1]];
    hydrateState(endState);

    const view = viewFor(endState, "player");
    const self = endState.sides.player;

    // Replay decks start empty — replace raw lengths with the estimate.
    view.deckCount = estimateDeckCount(self);
    view.opponent.deckCount = estimateDeckCount(endState.sides.opponent);

    // unseenOwn from the real deck list (viewFor computed it over the
    // near-empty replay deck, which is useless here).
    view.unseenOwn = listCounts
      ? unseenFromDeckList(listCounts, self)
      : { "(unknown)": view.deckCount + view.prizeCount };

    // Per-turn one-shot flags the sim keeps in TurnContext: recover them
    // from this turn's parsed actions when it was the player's turn.
    if (turn.actor === "player") {
      const acts = indices.map((i) => parsed.actions[i]);
      view.retreatUsedThisTurn = acts.some(
        (a) => a.actor === "player" && a.action_type === "retreat",
      );
      view.stadiumPlayedThisTurn = acts.some(
        (a) => a.actor === "player" && a.action_type === "play_stadium",
      );
    } else {
      // The reducer only resets the player's within-turn counters at the
      // player's NEXT turn_start, so at the end of an opponent turn the
      // snapshot still carries values from the player's previous turn.
      // Zero them — they describe a turn that is over.
      view.energyAttachedThisTurn = 0;
      view.supporterPlayedThisTurn = false;
    }

    views.push({ turn_number: turn.turn_number, actor: turn.actor, view });
  }

  // Coverage over the final state — by then every card that will ever be
  // visible is visible, so this is the honest denominator.
  const final = replayResult.finalState ?? initialState;
  hydrateState(final);
  return { views, cardCoverage: coverageOf(final) };
}
