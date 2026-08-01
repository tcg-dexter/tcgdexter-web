// Effect runtime (W2b) — the enumeration + apply engine that compiles a
// declarative CardEffect into the engine's move model, using the universal
// pick encoding (Option A). Enumeration turns TargetSpecs into concrete legal
// moves the planner/UI choose from; apply resolves a move's picks back into
// targets and runs the primitive ops.
//
// Built and proven in isolation first; the live legalMoves/validate/driver/
// client wiring is a separate, deliberate cutover.

import type { CardInstance, GameState, PokemonInPlay } from "../../types";
import type { Rng } from "../rng";

import { energyProvides } from "../setup";
import { applyOps, type OpContext, type ResolvedMon, type ResolvedTargets } from "./primitives";
import { isSupporter } from "../trainers";
import { DEFENDER_REF, OWN_ACTIVE_REF, SELF_REF } from "./types";
export { guardsPass } from "./guards";
import { guardsPass } from "./guards";
// Matchers live in match.ts so primitives.ts can share them without a cycle.
export { cardMatches, monMatches } from "./match";
import { cardMatches, monMatches } from "./match";
import type {
  CardEffect,
  CardFilter,
  DamageCount,
  DamageFormula,
  Guard,
  MonFilter,
  TargetSpec,
} from "./types";

type Actor = "player" | "opponent";
const other = (a: Actor): Actor => (a === "player" ? "opponent" : "player");

/** The universal, card-agnostic move produced by the runtime. `picks` records
 *  the chosen ids per target-slot ref; the source is the hand card (trainer)
 *  or the in-play Pokémon (ability). */
export interface EffectPick {
  ref: string;
  monIds?: string[];
  cardIds?: string[];
  /** Display names parallel to the ids (for the client UI, which labels picks
   *  without seeing hidden zones — mirrors PlayTrainerMove.deckCardNames).
   *  Ignored by validation (which fingerprints ids only) and by apply. */
  monNames?: string[];
  cardNames?: string[];
}
export interface EffectMove {
  kind: "effect";
  sourceId: string;
  card: string;
  effectIndex: number;
  picks: EffectPick[];
}

/* ─── Candidate resolution ──────────────────────────────────────── */

function zoneOf(state: GameState, actor: Actor, spec: TargetSpec): CardInstance[] {
  const side = spec.card!.side === "opponent" ? other(actor) : actor;
  const z = spec.card!.zone;
  return z === "deck" ? state.sides[side].deck : z === "discard" ? state.sides[side].discard : state.sides[side].hand;
}

function dedupeByName(cards: CardInstance[]): CardInstance[] {
  const seen = new Set<string>();
  return cards.filter((c) => (seen.has(c.name) ? false : (seen.add(c.name), true)));
}

function candidateCards(state: GameState, actor: Actor, spec: TargetSpec): CardInstance[] {
  return dedupeByName(zoneOf(state, actor, spec).filter((c) => cardMatches(c, spec.card!.filter)));
}

function candidateMons(state: GameState, actor: Actor, spec: TargetSpec): ResolvedMon[] {
  const side: Actor = spec.mon!.side === "opponent" ? other(actor) : actor;
  const s = state.sides[side];
  const pool: PokemonInPlay[] =
    spec.mon!.zone === "active"
      ? s.active
        ? [s.active]
        : []
      : spec.mon!.zone === "bench"
        ? s.bench
        : [s.active, ...s.bench].filter((m): m is PokemonInPlay => m !== null);
  return pool.filter((m) => monMatches(m, spec.mon!)).map((mon) => ({ mon, side }));
}

/* ─── State-dependent damage ────────────────────────────────────── */

const MAX_COIN_FLIPS = 50; // guard against a pathological rng stream

/** Evaluate a DamageCount against the board. `rng` is consumed only by the
 *  coin-flip count, and only at real damage resolution (the AI's move
 *  evaluation uses the printed number via baseDamage). */
function evalCount(
  state: GameState,
  actor: Actor,
  source: PokemonInPlay | null,
  count: DamageCount,
  rng: Rng | null,
): number {
  const side = state.sides[actor];
  const opp = state.sides[other(actor)];
  const sidesFor = (which: "own" | "opponent" | "both") =>
    which === "own" ? [side] : which === "opponent" ? [opp] : [side, opp];

  switch (count.of) {
    case "opp_prizes_taken":
      // Prizes the opponent has TAKEN — indexed by the side that took them.
      return state.prizesTaken[other(actor)];
    case "bench_count":
      return sidesFor(count.side).reduce((n, s) => n + s.bench.length, 0);
    case "energy_on_active":
      return sidesFor(count.side).reduce(
        (n, s) => n + (s.active ? s.active.attachedEnergy.length : 0),
        0,
      );
    case "mons_in_play": {
      const s = count.side === "opponent" ? opp : side;
      const pool = [s.active, ...s.bench].filter((m): m is PokemonInPlay => m !== null);
      return count.filter ? pool.filter((m) => monMatches(m, count.filter!)).length : pool.length;
    }
    case "cards_in_zone": {
      const s = count.side === "opponent" ? opp : side;
      const zone = count.zone === "discard" ? s.discard : s.hand;
      return zone.filter((c) => cardMatches(c, count.filter)).length;
    }
    case "coin_flips_until_tails": {
      if (!rng) return 0; // ghost evaluation: no rng, no flips
      let heads = 0;
      while (heads < MAX_COIN_FLIPS && rng() < 0.5) heads++;
      return heads;
    }
    case "coin_flips": {
      if (!rng) return 0;
      let heads = 0;
      for (let i = 0; i < count.n; i++) if (rng() < 0.5) heads++;
      return heads;
    }
    case "damage_counters_on": {
      const s = count.side === "opponent" ? opp : side;
      const pool =
        count.zone === "active"
          ? s.active
            ? [s.active]
            : []
          : count.zone === "bench"
            ? s.bench
            : [s.active, ...s.bench].filter((m): m is PokemonInPlay => m !== null);
      const matched = count.filter ? pool.filter((m) => monMatches(m, count.filter!)) : pool;
      // Counters, not raw damage: 10 damage = 1 counter.
      return matched.reduce((n, m) => n + Math.floor(m.damage / 10), 0);
    }
    case "energy_attached_all": {
      const s = count.side === "opponent" ? opp : side;
      const pool = [s.active, ...s.bench].filter((m): m is PokemonInPlay => m !== null);
      return pool.reduce(
        (n, m) =>
          n +
          m.attachedEnergy.filter(
            (c) => !count.energyType || energyProvides(c) === count.energyType,
          ).length,
        0,
      );
    }
    case "self_prizes_taken":
      return state.prizesTaken[actor];
    case "opp_prizes_taken_last_turn":
      return opp.prizesTakenLastTurn ?? 0;
    case "opp_hand_size":
      return opp.hand.length;
  }
  void source;
  return 0;
}

/** Base damage from a declarative formula: base + per × count + bonuses. */
export function evalDamageFormula(
  state: GameState,
  actor: Actor,
  source: PokemonInPlay | null,
  formula: DamageFormula,
  rng: Rng | null,
): number {
  let total = formula.base;
  if (formula.count && formula.per) {
    total += formula.per * evalCount(state, actor, source, formula.count, rng);
  }
  for (const bonus of formula.bonuses ?? []) {
    if (guardsPass(state, actor, source, [bonus.when])) total += bonus.amount;
  }
  // Optional discard cost. MUTATES, so real resolution only (rng non-null).
  if (formula.discardBoost && rng && source) {
    total += payDiscardBoost(state, actor, source, formula.discardBoost);
  }
  return Math.max(0, total);
}

/** Pay a formula's optional discard cost and return the damage it bought.
 *  Always takes the maximum available — see DamageFormula.discardBoost. */
function payDiscardBoost(
  state: GameState,
  actor: Actor,
  source: PokemonInPlay,
  boost: NonNullable<DamageFormula["discardBoost"]>,
): number {
  const side = state.sides[actor];
  const pools: { cards: CardInstance[]; owner: CardInstance[] }[] = [];
  if (boost.from === "self") {
    pools.push({ cards: source.attachedEnergy, owner: source.attachedEnergy });
  } else if (boost.from === "own_bench") {
    for (const m of side.bench) pools.push({ cards: m.attachedEnergy, owner: m.attachedEnergy });
  } else {
    pools.push({ cards: side.hand, owner: side.hand });
  }

  const cap = boost.exactly ?? boost.max ?? Number.MAX_SAFE_INTEGER;
  const picked: { zone: CardInstance[]; card: CardInstance }[] = [];
  for (const pool of pools) {
    for (const card of [...pool.cards]) {
      if (picked.length >= cap) break;
      if (cardMatches(card, boost.filter)) picked.push({ zone: pool.owner, card });
    }
  }
  // "Discard exactly N or nothing" — an all-or-nothing cost.
  if (boost.exactly != null && picked.length < boost.exactly) return 0;

  for (const { zone, card } of picked) {
    const i = zone.findIndex((c) => c.id === card.id);
    if (i < 0) continue;
    const [paid] = zone.splice(i, 1);
    if (boost.to === "deck") side.deck.push(paid);
    else side.discard.push(paid);
  }
  if (picked.length === 0) return 0;
  return picked.length * boost.per + (boost.flat ?? 0);
}

/* ─── Enumeration ───────────────────────────────────────────────── */

/** Options for one target slot: each option is one EffectPick. A `player`
 *  chooser yields one option per candidate; `auto` collapses to the first;
 *  `all` yields a single option covering every candidate. */
/** Ceiling on the options ONE target slot may produce. "Up to 3" over a wide
 *  deck is genuinely large, and slots multiply through the cartesian product,
 *  so an uncapped enumeration would blow up legalMoves (and every policy that
 *  scores it). Truncation is deterministic — zone order — so replay is stable.
 *
 *  These were 60/200 while only a handful of cards were declarative. Once the
 *  field landed (W3) the planner-latency test caught the cost: legalMoves runs
 *  many times per turn and the planner scores every move, so broad searches
 *  (Ciphermaniac's unfiltered choose-2, Noctowl's "up to 2 cards") dominated
 *  the budget — 60 hard-vs-hard games went from ~1.1s to ~16s. Tightened to
 *  the point where a search still offers a real choice but the AI isn't
 *  ranking dozens of near-identical fetches. A genuine multi-option chooser
 *  is W4's job; until then more options buy accuracy the policies can't use. */
const MAX_SLOT_OPTIONS = 12;
const MAX_EFFECT_MOVES = 24;

/** Choose `k` items, allowing an item to repeat up to `copies` times.
 *  Multi-pick of the SAME NAME is legal and often correct (Cyrano taking two
 *  copies of one Pokémon ex), which is exactly what the by-name candidate
 *  dedupe would otherwise forbid — so repeats are modelled by copy count
 *  rather than by listing every physical card. Combinations, not permutations:
 *  picking A then B is the same choice as B then A. */
function combinationsWithCopies<T>(
  groups: { item: T; copies: number }[],
  k: number,
  limit: number,
): T[][] {
  if (k <= 0) return [[]];
  const out: T[][] = [];
  const walk = (start: number, left: number, acc: T[]): void => {
    if (out.length >= limit) return;
    if (left === 0) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i < groups.length; i++) {
      const { item, copies } = groups[i];
      // Take 1..copies of this item, then move on to strictly later items —
      // that ordering is what makes these combinations rather than orderings.
      for (let take = 1; take <= Math.min(copies, left); take++) {
        for (let n = 0; n < take; n++) acc.push(item);
        walk(i + 1, left - take, acc);
        acc.length -= take;
        if (out.length >= limit) return;
      }
    }
  };
  walk(0, k, []);
  return out;
}

/** Sizes a slot may resolve to: exactly `count`, or 0..count when `upTo`. */
function slotSizes(spec: TargetSpec, available: number): number[] {
  const want = Math.max(0, spec.count ?? 1);
  const capped = Math.min(want, available);
  if (!spec.upTo) return [capped];
  // Largest first: "up to N" is usually best taken in full, and if the cap
  // truncates we keep the most useful options.
  const sizes: number[] = [];
  for (let n = capped; n >= 0; n--) sizes.push(n);
  return sizes;
}

function specOptions(state: GameState, actor: Actor, spec: TargetSpec): EffectPick[] {
  if (spec.select === "mon") {
    const cands = candidateMons(state, actor, spec);
    const pick = (ms: ResolvedMon[]): EffectPick => ({
      ref: spec.ref,
      monIds: ms.map((m) => m.mon.id),
      monNames: ms.map((m) => m.mon.card.name),
    });
    if (cands.length === 0) return spec.upTo ? [pick([])] : [];
    if (spec.chooser === "all") return [pick(cands)];
    const wanted = Math.max(1, spec.count ?? 1);
    if (spec.chooser === "auto") return [pick(cands.slice(0, wanted))];
    // Each Pokémon in play is a distinct entity — no copies to collapse.
    const groups = cands.map((m) => ({ item: m, copies: 1 }));
    const out: EffectPick[] = [];
    for (const size of slotSizes(spec, cands.length)) {
      for (const combo of combinationsWithCopies(groups, size, MAX_SLOT_OPTIONS - out.length)) {
        out.push(pick(combo));
      }
      if (out.length >= MAX_SLOT_OPTIONS) break;
    }
    return out;
  }

  const zone = zoneOf(state, actor, spec);
  const matching = zone.filter((c) => cardMatches(c, spec.card!.filter));
  const pick = (cs: CardInstance[]): EffectPick => ({
    ref: spec.ref,
    cardIds: cs.map((c) => c.id),
    cardNames: cs.map((c) => c.name),
  });
  if (matching.length === 0) return spec.upTo ? [pick([])] : [];
  if (spec.chooser === "all") return [pick(matching)];
  const wanted = Math.max(1, spec.count ?? 1);
  if (spec.chooser === "auto") return [pick(dedupeByName(matching).slice(0, wanted))];

  // Group the physical cards by name: the CHOICE is which names to take and
  // how many of each; which specific copy is irrelevant and would only
  // multiply identical moves.
  const byName = new Map<string, CardInstance[]>();
  for (const c of matching) {
    const bucket = byName.get(c.name);
    if (bucket) bucket.push(c);
    else byName.set(c.name, [c]);
  }
  const groups = Array.from(byName.values()).map((cs) => ({ item: cs, copies: cs.length }));

  const out: EffectPick[] = [];
  for (const size of slotSizes(spec, matching.length)) {
    const combos = combinationsWithCopies(groups, size, MAX_SLOT_OPTIONS - out.length);
    for (const combo of combos) {
      // combo holds one bucket entry per copy taken; hand back distinct cards.
      const used = new Map<CardInstance[], number>();
      const cards: CardInstance[] = [];
      for (const bucket of combo) {
        const i = used.get(bucket) ?? 0;
        used.set(bucket, i + 1);
        cards.push(bucket[i]);
      }
      out.push(pick(cards));
    }
    if (out.length >= MAX_SLOT_OPTIONS) break;
  }
  return out;
}

/** All concrete moves for a card's effect (empty if guards fail or a required
 *  target has no candidate). Each slot enumerates its own combinations
 *  (including multi-pick and same-name repeats); the cartesian product then
 *  spans slots (e.g. energy × mon). Both are capped — per slot by
 *  MAX_SLOT_OPTIONS, and across slots by MAX_EFFECT_MOVES. */
export function enumerateEffect(
  state: GameState,
  actor: Actor,
  source: { id: string; name: string },
  effect: CardEffect,
  effectIndex: number,
  sourceMon: PokemonInPlay | null = null,
): EffectMove[] {
  if (!guardsPass(state, actor, sourceMon, effect.guards)) return [];
  const base: EffectMove = { kind: "effect", sourceId: source.id, card: source.name, effectIndex, picks: [] };
  const specs = effect.targets ?? [];
  let combos: EffectPick[][] = [[]];
  for (const spec of specs) {
    const opts = specOptions(state, actor, spec);
    if (opts.length === 0) return []; // a required slot with no candidate
    const next: EffectPick[][] = [];
    for (const combo of combos) {
      for (const opt of opts) {
        if (next.length >= MAX_EFFECT_MOVES) break;
        next.push([...combo, opt]);
      }
      if (next.length >= MAX_EFFECT_MOVES) break;
    }
    combos = next;
  }
  return combos.map((picks) => ({ ...base, picks }));
}

/* ─── Apply ─────────────────────────────────────────────────────── */

function resolveTargets(
  state: GameState,
  actor: Actor,
  effect: CardEffect,
  move: EffectMove,
  source: PokemonInPlay | null,
): ResolvedTargets {
  const specByRef = new Map((effect.targets ?? []).map((s) => [s.ref, s]));
  const resolved: ResolvedTargets = {};
  // The reserved `self` ref: always the source Pokémon, never enumerated.
  if (source) resolved[SELF_REF] = { mons: [{ mon: source, side: actor }], cards: [] };
  const ownActive = state.sides[actor].active;
  if (ownActive) resolved[OWN_ACTIVE_REF] = { mons: [{ mon: ownActive, side: actor }], cards: [] };
  const defender = state.sides[other(actor)].active;
  if (defender) resolved[DEFENDER_REF] = { mons: [{ mon: defender, side: other(actor) }], cards: [] };
  for (const pick of move.picks) {
    const spec = specByRef.get(pick.ref);
    if (!spec) continue;
    if (pick.monIds?.length) {
      const side: Actor = spec.mon!.side === "opponent" ? other(actor) : actor;
      const inPlay = [state.sides[side].active, ...state.sides[side].bench].filter(
        (m): m is PokemonInPlay => m !== null,
      );
      resolved[pick.ref] = {
        mons: pick.monIds
          .map((id) => inPlay.find((m) => m.id === id))
          .filter((m): m is PokemonInPlay => m != null)
          .map((mon) => ({ mon, side })),
        cards: [],
      };
    } else if (pick.cardIds?.length) {
      const zone = zoneOf(state, actor, spec);
      resolved[pick.ref] = {
        mons: [],
        cards: pick.cardIds
          .map((id) => zone.find((c) => c.id === id))
          .filter((c): c is CardInstance => c != null),
      };
    }
  }
  return resolved;
}

/** Apply a validated effect move: trainer housekeeping (leave hand → discard,
 *  supporter gate), or ability once-per-turn marking, then run the ops. */
export function applyEffect(
  state: GameState,
  actor: Actor,
  effect: CardEffect,
  move: EffectMove,
  rng: Rng | null,
  /** The source Pokémon for non-trainer triggers. Defaults to a lookup by
   *  `move.sourceId`; pass explicitly for `attack_rider` (the attacker). */
  sourceMon: PokemonInPlay | null = null,
  /** Extra bound refs for hook-driven triggers (on_damaged binds "attacker"). */
  extraRefs: ResolvedTargets = {},
): void {
  const side = state.sides[actor];

  if (effect.trigger.kind === "trainer") {
    const idx = side.hand.findIndex((c) => c.id === move.sourceId);
    if (idx < 0) return;
    const cardInstance = side.hand[idx];
    side.hand.splice(idx, 1);
    if (isSupporter(cardInstance)) {
      side.supporterPlayedThisTurn = true;
      side.supporterNamePlayedThisTurn = cardInstance.name;
    }
    side.discard.push(cardInstance); // the trainer itself
  }

  const source =
    effect.trigger.kind === "trainer"
      ? null
      : (sourceMon ?? [side.active, ...side.bench].find((m) => m?.id === move.sourceId) ?? null);

  const targets = { ...resolveTargets(state, actor, effect, move, source), ...extraRefs };
  const ctx: OpContext = { state, actor, targets, rng, source, selfCardName: move.card };
  applyOps(effect.ops, ctx);

  if (effect.trigger.kind === "activated" || effect.trigger.kind === "on_play") {
    if (source && effect.ability) source.abilitiesUsedThisTurn.push(effect.ability);
  }
}
