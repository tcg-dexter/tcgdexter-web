// DecisionPolicy: the seam between game rules and play skill. The driver
// asks the policy which legal move to take; smarter policies (the turn
// planner, learned policies later) slot in behind the same interface
// without touching the rules.
//
// Policies see a PlayerView — the information set a real player has (own
// hand, public boards/discards, hidden-zone counts) — never the raw
// GameState. HeuristicPolicy implements the v1 lines: develop the board,
// attach toward the best attacker, evolve when able, attack for KOs,
// retreat when trapped.

import type { PokemonInPlay } from "../types";
import {
  baseDamage,
  canPayCost,
  computeDamage,
  remainingHp,
  usableAttacks,
  type SimMove,
  type TurnContext,
} from "./moves";
import { energyProvides } from "./setup";
import { trainerSpec, type PlayTrainerMove, type TrainerSpec } from "./trainers";
import { estimatedAttackDamage } from "./attacks";
import { activatedPhase } from "./abilities";
import { effectMovePhase, isEnergyAccelEffect, isSelfSwitchEffect } from "./effects/cards";
import { searchTargetValue } from "./effects/cardValue";
import type { EffectMove } from "./effects/runtime";
import type { PlayerView } from "./view";

/** Legal declarative-effect moves of a coarse phase (draw/search/tactical).
 *  The generic seam by which the policies play declarative cards the legacy
 *  registry doesn't cover — legacy staples keep their tuned handling. */
function effectMovesOf(
  legal: SimMove[],
  phase: "draw" | "search" | "tactical",
): EffectMove[] {
  return legal.filter(
    (m): m is EffectMove => m.kind === "effect" && effectMovePhase(m.card, m.effectIndex) === phase,
  );
}

export interface DecisionPolicy {
  /** Pick one of the legal moves. Returning an attack or pass ends the turn. */
  chooseMove(view: PlayerView, legal: SimMove[], ctx: TurnContext): SimMove;
  /** Own bench index to promote after this side's active is knocked out. */
  choosePromotion(view: PlayerView): number;
}

/* ─── Heuristic v1 ──────────────────────────────────────────────── */

/** Stop spending deck on draws/searches below this (turn-start draws must
 *  keep flowing — deck-out is a loss). Mirrors the planner's reserve. */
const DECK_RESERVE = 8;

/** Pick a beneficial activated ability from the legal set, or null.
 *
 *  Card-flow abilities (Trade, Flip the Script, Attract Customers) come FIRST
 *  and are classified by `activatedPhase`, not by name. They are the draw
 *  engines of modern Pokémon — a real N's Zoroark player uses Trade every
 *  single turn — and while this function was a two-name allowlist they were
 *  enumerated as legal moves and then silently discarded, which is why those
 *  decks never drew energy, never attacked, and decked out.
 *
 *  Then the tactical ones: Munkidori (move counters toward a KO) is almost
 *  always good; Dusknoir's self-KO Cursed Blast only when its 13 counters
 *  (130) actually KO. */
export function chooseAbilityMove(view: PlayerView, legal: SimMove[]): SimMove | null {
  const abilities = legal.filter(
    (m): m is Extract<SimMove, { kind: "use_ability" }> => m.kind === "use_ability",
  );
  if (abilities.length === 0) return null;

  // Card flow, deck-reserve guarded like every other draw branch.
  if (view.deckCount > DECK_RESERVE) {
    const monName = (id: string) =>
      inPlay(view.board).find((m) => m.id === id)?.card.name ?? "";
    const flow = abilities.filter((m) => {
      const phase = activatedPhase(monName(m.monId), m.abilityName);
      return phase === "draw" || phase === "search";
    });
    if (flow.length > 0) return flow[0];
  }

  const oppMons = [view.opponent.board.active, ...view.opponent.board.bench].filter(
    (m): m is PokemonInPlay => m !== null,
  );
  const hpLeft = (id: string | undefined) => {
    const mon = oppMons.find((m) => m.id === id);
    return mon ? (mon.card.catalog?.hp ?? 120) - mon.damage : Infinity;
  };

  // Cursed Blast: only when 130 damage knocks the target out.
  const cursed = abilities.filter((m) => m.abilityName === "Cursed Blast");
  const lethalCursed = cursed
    .filter((m) => hpLeft(m.targetMonId) <= 130)
    .sort((a, b) => hpLeft(a.targetMonId) - hpLeft(b.targetMonId));
  if (lethalCursed.length > 0) return lethalCursed[0];

  // Adrena-Brain: move counters onto the opponent mon closest to a KO.
  const adrena = abilities
    .filter((m) => m.abilityName === "Adrena-Brain")
    .sort((a, b) => hpLeft(a.targetMonId) - hpLeft(b.targetMonId));
  if (adrena.length > 0) return adrena[0];

  return null;
}

/** Best damage this Pokémon could ever do (its attack ceiling), counting
 *  declarative formulas and riders — not just the printed number. Attacks
 *  whose damage lives in a rider print as "" and would rank 0 here, so the
 *  attach heuristic below would never arm them. */
function attackCeiling(mon: PokemonInPlay, view?: PlayerView): number {
  const n = (mon.card.catalog?.attacks ?? []).length;
  // Copy-an-attack (Night Joker) has no printed damage of its own — its
  // ceiling is whatever sits on the bench, so pass the board when we have it.
  const board = view
    ? { ownBench: view.board.bench, oppActive: view.opponent.board.active }
    : undefined;
  let best = 0;
  for (let i = 0; i < n; i++) {
    best = Math.max(best, estimatedAttackDamage(mon, i, undefined, "player", board));
  }
  return best;
}

/** How much MORE energy this Pokémon needs before it can use `attack`. */
function energyShortfall(mon: PokemonInPlay, cost: string[]): number {
  return Math.max(0, cost.length - mon.attachedEnergy.length);
}

/** Who deserves the turn's one energy attachment.
 *
 *  Ranking by raw attack ceiling — which is what this did — quietly assumes
 *  energy is free. It is not: attachment is once per turn, and the engine
 *  decks run 6-8 Energy in 60 where the aggro decks run 13. Alakazam's
 *  Powerful Hand costs ONE Psychic for ~100 damage, but the same deck holds
 *  Genesect (110 for three) and Dudunsparce (90 for three), which score a
 *  higher ceiling. So the AI fed the three-cost attackers that never came
 *  online and left the one-cost payoff attacker empty — a legal attack on
 *  ~25% of its turns, against ~65% for the decks that need no help.
 *
 *  Score damage per turn of investment instead: a big attack two attachments
 *  away is worth less right now than a slightly smaller one that fires this
 *  turn. That is tempo, and it is what the calibration residual has been
 *  measuring all along. */
function attachPriority(mon: PokemonInPlay, view?: PlayerView): number {
  const attacks = mon.card.catalog?.attacks ?? [];
  const board = view
    ? { ownBench: view.board.bench, oppActive: view.opponent.board.active }
    : undefined;
  let best = 0;
  attacks.forEach((attack, i) => {
    const dmg = estimatedAttackDamage(mon, i, undefined, "player", board);
    if (dmg <= 0) return;
    // +1 so an already-affordable attack isn't divided by zero, and so the
    // gap between "ready now" and "one away" is the largest single step.
    best = Math.max(best, dmg / (1 + energyShortfall(mon, attack.cost)));
  });
  return best;
}

function inPlay(board: PlayerView["board"]): PokemonInPlay[] {
  return [board.active, ...board.bench].filter((m): m is PokemonInPlay => m !== null);
}

/* ─── W4: what a search actually FETCHES ────────────────────────── */

/** Value of pulling `name` out of the deck, given what is already in play.
 *
 *  Shared by every search path. Both policies used to take the FIRST
 *  enumerated option — `searches[0]` / `legal.find(...)` — so Ultra Ball,
 *  Nest Ball, Buddy-Buddy Poffin, Cyrano, Arven and the rest fetched whatever
 *  the enumerator happened to list first. For an aggro deck that barely
 *  matters; for an engine deck, searching up the right piece IS the deck,
 *  which is exactly the shape of the calibration residual (the sim
 *  under-rates the most-played, most engine-heavy archetypes).
 *
 *  Ranking rationale: completing an evolution line already on the board beats
 *  everything (that card is dead in the deck and live in hand), then real
 *  attackers by how hard they hit, then Energy, then generic Trainers. */

export { searchTargetValue };

/** Names a declarative effect move would pull out of hidden zones. */
function effectPickNames(m: EffectMove): string[] {
  const out: string[] = [];
  for (const p of m.picks) {
    if (p.cardNames) out.push(...p.cardNames);
    if (p.monNames) out.push(...p.monNames);
  }
  return out;
}

/** Best of several enumerations of the SAME search card — i.e. which cards to
 *  fetch. Falls back to the first move when nothing scores. */
export function bestEffectPick(view: PlayerView, moves: EffectMove[]): EffectMove {
  const inPlayNames = new Set(inPlay(view.board).map((m) => m.card.name));
  let best = moves[0];
  let bestScore = -Infinity;
  for (const m of moves) {
    const names = effectPickNames(m);
    // An empty pick set means "found nothing" — legal (searches may fail) but
    // strictly worse than any real hit, so it must not win by default.
    const score =
      names.length === 0
        ? 0
        : names.reduce((sum, n) => sum + searchTargetValue(n, inPlayNames), 0);
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}

/** Group effect moves by the card+effect they come from, so we only compare
 *  alternative PICKS of one card rather than ranking different cards by the
 *  size of their haul (which would always prefer the greediest search). */
export function chooseEffectMove(view: PlayerView, moves: EffectMove[]): EffectMove | null {
  if (moves.length === 0) return null;
  const firstKey = `${moves[0].card}::${moves[0].effectIndex}`;
  const sameCard = moves.filter((m) => `${m.card}::${m.effectIndex}` === firstKey);
  return bestEffectPick(view, sameCard);
}

/** Which LEGACY search trainer to play, and what it fetches. Lived in the
 *  planner; the heuristic had no chooser at all and played `searches[0]`. */
export function bestSearchTrainer(view: PlayerView, moves: PlayTrainerMove[]): PlayTrainerMove {
  const inPlayNames = new Set(inPlay(view.board).map((m) => m.card.name));
  let best = moves[0];
  let bestScore = -1;
  for (const move of moves) {
    const names = move.deckCardNames ?? (move.discardPickName ? [move.discardPickName] : []);
    const score = names.reduce(
      (s, n) => s + searchTargetValue(n, inPlayNames),
      names.length === 0 ? 10 : 0,
    );
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}

/** Legacy trainers whose whole point is putting extra Energy into play. */
const ACCEL_TRAINER_KINDS = new Set(["ns_pp_up", "crispin", "janine"]);

/** Would extra energy actually change anything? Only if something in play
 *  still can't use all of its attacks. Accelerating onto a fully-armed board
 *  spends cards for nothing. */
export function needsEnergy(view: PlayerView): boolean {
  return inPlay(view.board).some(
    (m) => usableAttacks(m).length < (m.card.catalog?.attacks.length ?? 0),
  );
}

/** Energy-acceleration moves — legacy and declarative — or an empty list.
 *  Played during DEVELOPMENT, before the attack branch ends the turn. */
export function energyAccelMoves(view: PlayerView, legal: SimMove[]): SimMove[] {
  if (!needsEnergy(view)) return [];
  const out: SimMove[] = [];
  for (const m of legal) {
    if (m.kind === "play_trainer") {
      const card = view.hand.find((c) => c.id === m.cardId);
      const spec = card ? trainerSpec(card) : null;
      if (spec && ACCEL_TRAINER_KINDS.has(spec.effect.kind)) out.push(m);
    } else if (m.kind === "effect" && isEnergyAccelEffect(m.card, m.effectIndex)) {
      out.push(m);
    }
  }
  return out;
}

/** Damage this Pokémon could deal RIGHT NOW, with the energy already on it. */
function damageNow(mon: PokemonInPlay, view: PlayerView): number {
  const board = { ownBench: view.board.bench, oppActive: view.opponent.board.active };
  let best = 0;
  for (const { index } of usableAttacks(mon)) {
    best = Math.max(best, estimatedAttackDamage(mon, index, undefined, "player", board));
  }
  return best;
}

/** Minimum edge, in damage, before it's worth spending a switch effect. */
const REPOSITION_EDGE = 30;

/** Put a better attacker in the Active spot using a switch EFFECT.
 *
 *  Distinct from the "I'm trapped" retreat branch: this is proactive setup.
 *  An attack-based payoff (Night Joker, and 7 other switch effects across the
 *  field) needs its Pokémon Active to do anything at all, and the effects that
 *  put it there classify as `tactical` — dead last, after the attack branch
 *  has already ended the turn. */
export function chooseRepositionEffect(view: PlayerView, legal: SimMove[]): SimMove | null {
  const active = view.board.active;
  if (!active) return null;
  const switches = legal.filter(
    (m): m is EffectMove => m.kind === "effect" && isSelfSwitchEffect(m.card, m.effectIndex),
  );
  if (switches.length === 0) return null;
  const activeDamage = damageNow(active, view);
  const benchByName = new Map(view.board.bench.map((m) => [m.card.name, m]));
  let best: SimMove | null = null;
  let bestGain = 0;
  for (const m of switches) {
    for (const pick of m.picks) {
      for (const name of pick.monNames ?? []) {
        const mon = benchByName.get(name);
        if (!mon) continue;
        // Judge the candidate on what it will do ONCE ARMED, not on what it
        // can do while sitting on the bench with no energy. Gating on current
        // damage was circular — energy goes to the attacker we intend to
        // promote, and we never promote it because it has no energy. The
        // branch fired once in 158 opportunities.
        //
        // The safety condition is the ACTIVE side of the trade: only switch
        // away from a Pokémon that isn't already doing the job.
        const gain = attachPriority(mon, view) - Math.max(activeDamage, attachPriority(active, view));
        if (gain > bestGain) {
          bestGain = gain;
          best = m;
        }
      }
    }
  }
  return bestGain >= REPOSITION_EDGE ? best : null;
}

/** A hand this size is not card-starved, it is ACTION-starved. */
const HAND_GLUT = 12;

/** Is spending deck on a search worth it right now?
 *
 *  Searches were gated on `deckCount > DECK_RESERVE` and nothing else, so both
 *  policies played every Ultra Ball / Poffin / Secret Box in hand every single
 *  turn. A search moves cards from deck to hand, and tracing Alakazam showed
 *  exactly that: deck 43 -> 13 while the hand grew 4.5 -> 20, about seven
 *  cards a turn. The AI was transferring its deck into its hand and then
 *  losing to deck-out in 47% of its games while posting 32% against a real
 *  58.1%.
 *
 *  A real player holding 20 cards does not play another ball — they play the
 *  cards they already have. Deck is the resource that keeps you alive; hand
 *  is only useful to the extent you can spend it. So searching stops paying
 *  once the hand is in surplus. */
export function wantsSearch(view: PlayerView): boolean {
  if (view.deckCount <= DECK_RESERVE) return false;
  return view.hand.length < HAND_GLUT;
}

/** Should the hand be refreshed? SMALL *or* DEAD.
 *
 *  The gate used to be hand size alone (<= 5), which produced the calibration
 *  death spiral: a hand grows to ~8 unplayable cards, the size gate closes,
 *  the AI never digs again, so it never draws energy. Energy-in-hand fell to
 *  0.1 by turn 6 and stayed there — no energy, no attacks, no prizes, and the
 *  game grinds out at one card per turn until someone decks out.
 *
 *  "No energy in hand" is the honest dead-hand signal: the draw branches are
 *  only reached once evolve/bench/ability/stadium/tool have all declined, so
 *  energy is the main thing left worth holding on to.
 *
 *  Shared with the planner, which had its own copy of the <= 5 gate. */
export function wantsDrawRefresh(view: PlayerView): boolean {
  if (view.hand.length <= 5) return true;
  // "No energy in hand" alone is FAR too eager. A deck running 6 Energy in 60
  // has an energy-less hand most turns, so this fired nearly every turn and
  // the AI dug its own deck out: Alakazam decked out in 47% of its games while
  // posting 32% against a real 58.1%. Deck-out is a loss, and burning deck to
  // find a card you do not need is how you get there.
  //
  // Dig only when energy would actually CHANGE something — i.e. some Pokémon
  // in play still can't attack. If every attacker is already armed, more
  // energy is dead weight and the deck is worth more than the cards.
  if (view.hand.some((c) => energyProvides(c) !== null)) return false;
  return inPlay(view.board).some(
    (m) => usableAttacks(m).length < (m.card.catalog?.attacks.length ?? 0),
  );
}

/** Which Pokémon to put on the Bench, or null if none is legal.
 *
 *  Both policies used to take the first legal bench move — whatever happened
 *  to sit first in hand — and the Bench fills to its cap of 5 by about turn 4.
 *  So the one Pokémon a deck actually needs back there often never fit: N's
 *  Zoroark's Night Joker copies a BENCHED N's Pokémon's attack, and benching
 *  Budew instead of N's Zekrom is the difference between copying 250 and
 *  copying 20.
 *
 *  Two things earn a slot: a Pokémon we can evolve (the line has to start
 *  somewhere, and it is dead weight until it does) and a Pokémon worth
 *  copying, promoting, or attacking with. */
export function chooseBenchMove(view: PlayerView, legal: SimMove[]): SimMove | null {
  const bench = legal.filter(
    (m): m is Extract<SimMove, { kind: "bench" }> => m.kind === "bench",
  );
  if (bench.length === 0) return null;
  const evolvableFromHand = new Set(
    view.hand.map((c) => c.catalog?.evolves_from).filter((n): n is string => Boolean(n)),
  );
  const score = (m: (typeof bench)[number]): number => {
    const cat = view.hand.find((c) => c.id === m.cardId)?.catalog;
    if (!cat) return 0;
    const printed = (cat.attacks ?? []).map((a) => {
      const n = parseInt(a.damage, 10);
      return Number.isFinite(n) ? n : 0;
    });
    const ceiling = printed.length > 0 ? Math.max(...printed) : 0;
    return (evolvableFromHand.has(cat.name) ? 1000 : 0) + ceiling + (cat.hp ?? 0) / 100;
  };
  return bench.slice().sort((a, b) => score(b) - score(a))[0];
}

export class HeuristicPolicy implements DecisionPolicy {
  chooseMove(view: PlayerView, legal: SimMove[], _ctx: TurnContext): SimMove {
    const active = view.board.active;
    const defender = view.opponent.board.active;
    const byKind = <K extends SimMove["kind"]>(kind: K) =>
      legal.filter((m): m is Extract<SimMove, { kind: K }> => m.kind === kind);
    const specOf = (m: SimMove): TrainerSpec | null => {
      if (m.kind !== "play_trainer") return null;
      const card = view.hand.find((c) => c.id === m.cardId);
      return card ? trainerSpec(card) : null;
    };
    const trainersBySpec = (pred: (s: TrainerSpec) => boolean) =>
      legal.filter((m): m is PlayTrainerMove => {
        const s = specOf(m);
        return s !== null && pred(s);
      });

    // 1. Evolve — Rare Candy first (skips a stage), then normal evolves,
    //    active-target preferred (it's the one taking hits).
    const candies = trainersBySpec((s) => s.effect.kind === "rare_candy");
    if (candies.length > 0) {
      return candies.find((m) => m.monId === active?.id) ?? candies[0];
    }
    const evolves = byKind("evolve");
    if (evolves.length > 0) {
      const activeEvolve = evolves.find((m) => m.targetId === active?.id);
      return activeEvolve ?? evolves[0];
    }

    // 2. Develop the bench, with purpose (shared with the planner).
    const benchMove = chooseBenchMove(view, legal);
    if (benchMove) return benchMove;

    // 2b. Activated abilities (don't end the turn). Play the beneficial ones.
    const ability = chooseAbilityMove(view, legal);
    if (ability) return ability;

    // 2c. Put a Stadium into play (replaces an opponent's; harmless to seat ours).
    const stadium = byKind("play_stadium");
    if (stadium.length > 0) return stadium[0];

    // 2d. Attach a Tool — prefer the active (the one taking hits / retreating).
    const tools = byKind("attach_tool");
    if (tools.length > 0) {
      return tools.find((m) => m.targetId === active?.id) ?? tools[0];
    }

    // 2e. Use an activated Stadium effect (Artazon: bench a Basic).
    const stadiumEffect = byKind("use_stadium");
    if (stadiumEffect.length > 0) return stadiumEffect[0];

    // 2f-. Reposition into a better attacker (setup, not a last resort).
    const reposition = chooseRepositionEffect(view, legal);
    if (reposition) return reposition;

    // 2f. Energy ACCELERATION, during development — before the attack branch
    //     ends the turn. See energyAccelMoves for why this placement matters.
    const accel = energyAccelMoves(view, legal);
    if (accel.length > 0) return accel[0];

    // 3. Draw fuel + searches: real draw supporters and deck searches
    //    before generic cycling — all deck-reserve guarded so we never
    //    draw ourselves out while ahead.
    if (view.deckCount > DECK_RESERVE) {
      const wantDraw = wantsDrawRefresh(view);
      const drawSupporters = trainersBySpec((s) => s.phase === "draw");
      if (drawSupporters.length > 0 && wantDraw) return drawSupporters[0];
      const drawEffects = effectMovesOf(legal, "draw");
      if (drawEffects.length > 0 && wantDraw) return chooseEffectMove(view, drawEffects)!;
      if (wantsSearch(view)) {
        const searches = trainersBySpec((s) => s.phase === "search");
        if (searches.length > 0) return bestSearchTrainer(view, searches);
        // Declarative search cards (Team Rocket's Transceiver, …) play here too.
        const searchEffects = effectMovesOf(legal, "search");
        if (searchEffects.length > 0) return chooseEffectMove(view, searchEffects)!;
      }
      const supporter = byKind("cycle_supporter");
      if (supporter.length > 0) return supporter[0];
    }

    // 3b. Boss's Orders when it converts into a knockout our active can
    //     take right now (and the standing defender can't be KO'd).
    const gusts = trainersBySpec((s) => s.effect.kind === "gust");
    if (gusts.length > 0 && active && defender) {
      const bestVs = (target: PokemonInPlay) =>
        Math.max(
          0,
          ...usableAttacks(active).map(({ attack }) => computeDamage(active, attack, target)),
        );
      if (bestVs(defender) < remainingHp(defender)) {
        const killable = gusts.find((m) => {
          const target = view.opponent.board.bench[m.oppBenchIndex ?? -1];
          return target != null && bestVs(target) >= remainingHp(target);
        });
        if (killable) return killable;
      }
    }

    // 4. Attach toward the highest-ceiling attacker that can't attack yet
    //    (the active breaks ties so it comes online sooner).
    const attaches = byKind("attach");
    if (attaches.length > 0) {
      const mons = inPlay(view.board);
      const needy = mons
        .filter((m) => usableAttacks(m).length < (m.card.catalog?.attacks.length ?? 0))
        // Ceiling first, active only as the tie-break. Prioritising the
        // ACTIVE instead was tested and is WORSE: it lifts attack frequency
        // 32.3% -> 35.8% but drops prize wins 67.1% -> 65.8% and pushes
        // deck-out 17.1% -> 18.8%. Attacking more often with a small attacker
        // spends the energy that should have built the real threat. Don't
        // re-try it without a matchup-level reason.
        .sort(
          (a, b) =>
            attachPriority(b, view) - attachPriority(a, view) ||
            (b.id === active?.id ? 1 : 0) - (a.id === active?.id ? 1 : 0),
        );
      const target = needy[0] ?? active ?? mons[0];
      if (target) {
        // Prefer an energy card whose type appears in the target's costs.
        const wanted = new Set(
          (target.card.catalog?.attacks ?? []).flatMap((a) => a.cost),
        );
        const preferred = attaches.find((m) => {
          if (m.targetId !== target.id) return false;
          const card = view.hand.find((c) => c.id === m.cardId);
          const provides = card ? energyProvides(card) : null;
          return provides !== null && wanted.has(provides);
        });
        const fallback = attaches.find((m) => m.targetId === target.id);
        const chosen = preferred ?? fallback;
        if (chosen) return chosen;
      }
      return attaches[0];
    }

    const items = byKind("cycle_item");
    if (items.length > 0 && view.deckCount > DECK_RESERVE) return items[0];

    // 5. Reposition when the active can't do anything USEFUL — not merely
    //    when it has no legal attack at all.
    //
    //    The old test was `usableAttacks(active).length === 0`, which misses
    //    the case that matters most: an active holding a legal attack that
    //    would deal ZERO. N's Zoroark with no N's Pokémon left on the bench
    //    has Night Joker available and it does literally nothing — before
    //    this, the AI stood there and spent the turn on it. Real players
    //    retreat to something that can actually hit.
    const bestDamageOf = (mon: PokemonInPlay | null): number => {
      if (!mon) return 0;
      const board = { ownBench: view.board.bench, oppActive: defender };
      return Math.max(
        0,
        ...usableAttacks(mon).map(({ attack, index }) =>
          Math.max(
            defender ? computeDamage(mon, attack, defender) : 0,
            estimatedAttackDamage(mon, index, undefined, "player", board),
          ),
        ),
      );
    };
    const activeDamage = bestDamageOf(active);
    if (active && activeDamage <= 0) {
      const betterOnBench = (mon: PokemonInPlay | null) =>
        mon != null && bestDamageOf(mon) > activeDamage;
      const switches = trainersBySpec((s) => s.effect.kind === "switch_active");
      const freeSwitch = switches.find((m) => betterOnBench(view.board.bench[m.benchIndex ?? -1]));
      if (freeSwitch) return freeSwitch;
      const retreats = byKind("retreat");
      const ready = retreats.find((m) => betterOnBench(view.board.bench[m.benchIndex]));
      if (ready) return ready;
    }

    // 6. Attack: cheapest lethal, else biggest hit.
    const attacks = byKind("attack");
    if (attacks.length > 0 && active && defender) {
      const scored = attacks.map((m) => {
        const attack = active.card.catalog!.attacks[m.attackIndex];
        // Estimate through the declarative path so formula/rider damage counts
        // — computeDamage alone reads the printed number and scores these 0.
        const raw = estimatedAttackDamage(active, m.attackIndex, undefined, "player", {
          ownBench: view.board.bench,
          oppActive: defender,
        });
        const dmg = Math.max(computeDamage(active, attack, defender), raw);
        return { move: m, dmg, lethal: dmg >= remainingHp(defender), cost: attack.cost.length };
      });
      const lethals = scored.filter((s) => s.lethal).sort((a, b) => a.cost - b.cost || b.dmg - a.dmg);
      if (lethals.length > 0) return lethals[0].move;
      const best = scored.sort((a, b) => b.dmg - a.dmg)[0];
      // Attack even at zero estimated damage. The turn is ending either way,
      // and a 0-damage attack is a utility attack — status, energy accel,
      // disruption. The probe found the AI declining a legal attack on 12%
      // of the turns it passed on, which is strictly worse than taking it.
      if (best) return best.move;
    }

    // Stranding guard: a declarative-effect move (e.g. a tactical one) that
    // no earlier branch consumed still beats passing — effect moves don't end
    // the turn, so the policy keeps playing the turn out next call.
    //
    // It MUST respect the deck reserve. Without this the guard replayed every
    // draw/search effect at any deck size, and once the field became fully
    // declarative that alone decked the AI out in ~23% of calibration games.
    // Tactical effects (gusts, damage, status) don't consume deck and are
    // always safe; draw/search are gated like every other draw branch.
    const anyEffect = legal.find((m): m is EffectMove => {
      if (m.kind !== "effect") return false;
      const phase = effectMovePhase(m.card, m.effectIndex);
      const consumesDeck = phase === "draw" || phase === "search";
      return !consumesDeck || view.deckCount > DECK_RESERVE;
    });
    if (anyEffect) return anyEffect;

    // The same guard for LEGACY trainers, which had none. The branches above
    // recognise draw/search/gust/switch/rare_candy and nothing else, so every
    // other tactical trainer was enumerated and then dropped on the floor —
    // including N's PP Up, which is energy ACCELERATION, in an AI that the
    // probe showed was permanently one energy short of attacking. Gust and
    // switch are excluded: branches 3b and 5 declined those on purpose.
    const anyTrainer = trainersBySpec(
      (s) =>
        s.effect.kind !== "gust" &&
        s.effect.kind !== "switch_active" &&
        (s.phase !== "draw" && s.phase !== "search" ? true : view.deckCount > DECK_RESERVE),
    );
    if (anyTrainer.length > 0) return anyTrainer[0];

    return { kind: "pass" };
  }

  choosePromotion(view: PlayerView): number {
    return promoteBest(view.board.bench);
  }
}

/** Most energy attached (closest to attacking), then attack ceiling, then
 *  HP. Deterministic on bench order for ties. Shared with the planner. */
export function promoteBest(bench: PokemonInPlay[]): number {
  let best = 0;
  let bestScore = -1;
  bench.forEach((mon, i) => {
    // Score against the bench that would REMAIN after promoting this one.
    // That matters for copy-an-attack: N's Zoroark's Night Joker is worth
    // whatever is still BEHIND it, so promoting the donor and promoting the
    // copier are not interchangeable. Also routes through the declarative
    // estimate, so an attack printing "" no longer reads as a 0 ceiling.
    const remaining = bench.filter((_, j) => j !== i);
    const attacks = (mon.card.catalog?.attacks ?? []).length;
    let ceiling = 0;
    for (let ai = 0; ai < attacks; ai++) {
      ceiling = Math.max(
        ceiling,
        estimatedAttackDamage(mon, ai, undefined, "player", { ownBench: remaining }),
      );
    }
    const score =
      mon.attachedEnergy.length * 10000 + ceiling * 10 + (mon.card.catalog?.hp ?? 0) / 100;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/** Sanity check used by tests: can the mon's best attack ever be paid. */
export function hasAffordableLine(mon: PokemonInPlay): boolean {
  return (mon.card.catalog?.attacks ?? []).some((a) => canPayCost(mon, a.cost));
}
