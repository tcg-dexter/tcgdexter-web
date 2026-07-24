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
import { prizeValue } from "../setup";
import { energyProvides } from "../setup";
import { applyOps, type OpContext, type ResolvedMon, type ResolvedTargets } from "./primitives";
import { isSupporter } from "../trainers";
import type { CardEffect, CardFilter, Guard, MonFilter, TargetSpec } from "./types";

type Actor = "player" | "opponent";
const other = (a: Actor): Actor => (a === "player" ? "opponent" : "player");

/** The universal, card-agnostic move produced by the runtime. `picks` records
 *  the chosen ids per target-slot ref; the source is the hand card (trainer)
 *  or the in-play Pokémon (ability). */
export interface EffectPick {
  ref: string;
  monIds?: string[];
  cardIds?: string[];
}
export interface EffectMove {
  kind: "effect";
  sourceId: string;
  card: string;
  effectIndex: number;
  picks: EffectPick[];
}

/* ─── Filters ───────────────────────────────────────────────────── */

function isBasicEnergyCard(c: CardInstance): boolean {
  return (
    c.catalog?.supertype === "Energy" &&
    (c.catalog.subtypes.includes("Basic") || c.name.startsWith("Basic "))
  );
}

export function cardMatches(c: CardInstance, f: CardFilter): boolean {
  const cat = c.catalog;
  if (!cat) return false;
  if (f.supertype && cat.supertype !== f.supertype) return false;
  if (f.subtype && !cat.subtypes.includes(f.subtype)) return false;
  if (f.basicPokemon && !(cat.supertype === "Pokémon" && !cat.evolves_from)) return false;
  if (f.basicEnergy && !isBasicEnergyCard(c)) return false;
  if (f.energyType && energyProvides(c) !== f.energyType) return false;
  if (f.namePrefix && !c.name.startsWith(f.namePrefix)) return false;
  if (f.maxHp != null && (cat.hp ?? Infinity) > f.maxHp) return false;
  if (f.singlePrize && prizeValue(c.name) !== 1) return false;
  return true;
}

function hasSpecialEnergy(mon: PokemonInPlay): boolean {
  return mon.attachedEnergy.some((c) => c.catalog?.supertype === "Energy" && !isBasicEnergyCard(c));
}

export function monMatches(mon: PokemonInPlay, f: MonFilter): boolean {
  const cat = mon.card.catalog;
  if (f.type && !(cat?.types.includes(f.type) ?? false)) return false;
  if (f.namePrefix && !mon.card.name.startsWith(f.namePrefix)) return false;
  if (f.basic && !(cat?.supertype === "Pokémon" && !cat.evolves_from)) return false;
  if (f.hasTool && mon.attachedTools.length === 0) return false;
  if (f.hasSpecialEnergy && !hasSpecialEnergy(mon)) return false;
  if (f.damaged && mon.damage < 10) return false;
  if (f.excludeName && mon.card.name === f.excludeName) return false;
  return true;
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

/* ─── Guards ────────────────────────────────────────────────────── */

export function guardsPass(
  state: GameState,
  actor: Actor,
  source: PokemonInPlay | null,
  guards: Guard[] | undefined,
): boolean {
  if (!guards) return true;
  const side = state.sides[actor];
  const opp = state.sides[other(actor)];
  return guards.every((g) => {
    switch (g.cond) {
      case "opp_prizes_lte":
        return opp.prizes.length <= g.n;
      case "self_prizes_lte":
        return side.prizes.length <= g.n;
      case "is_active":
        return source != null && side.active === source;
      case "koed_last_opp_turn":
        return side.koedLastOppTurn === true;
      case "has_energy_type":
        return source != null && source.attachedEnergy.some((c) => energyProvides(c) === g.type);
      case "deck_has":
        return side.deck.some((c) => cardMatches(c, g.filter));
      case "discard_has":
        return side.discard.some((c) => cardMatches(c, g.filter));
    }
  });
}

/* ─── Enumeration ───────────────────────────────────────────────── */

/** Options for one target slot: each option is one EffectPick. A `player`
 *  chooser yields one option per candidate; `auto` collapses to the first;
 *  `all` yields a single option covering every candidate. */
function specOptions(state: GameState, actor: Actor, spec: TargetSpec): EffectPick[] {
  if (spec.select === "mon") {
    const cands = candidateMons(state, actor, spec);
    if (cands.length === 0) return spec.upTo ? [{ ref: spec.ref, monIds: [] }] : [];
    if (spec.chooser === "all") return [{ ref: spec.ref, monIds: cands.map((m) => m.mon.id) }];
    if (spec.chooser === "auto") return [{ ref: spec.ref, monIds: [cands[0].mon.id] }];
    return cands.map((m) => ({ ref: spec.ref, monIds: [m.mon.id] }));
  }
  const cands = candidateCards(state, actor, spec);
  if (cands.length === 0) return spec.upTo ? [{ ref: spec.ref, cardIds: [] }] : [];
  if (spec.chooser === "all") return [{ ref: spec.ref, cardIds: cands.map((c) => c.id) }];
  if (spec.chooser === "auto") return [{ ref: spec.ref, cardIds: [cands[0].id] }];
  return cands.map((c) => ({ ref: spec.ref, cardIds: [c.id] }));
}

/** All concrete moves for a card's effect (empty if guards fail or a required
 *  target has no candidate). v1 enumerates a single pick per slot; the
 *  cartesian product spans multiple target slots (e.g. energy × mon). */
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
    for (const combo of combos) for (const opt of opts) next.push([...combo, opt]);
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
): ResolvedTargets {
  const specByRef = new Map((effect.targets ?? []).map((s) => [s.ref, s]));
  const resolved: ResolvedTargets = {};
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
): void {
  const side = state.sides[actor];

  if (effect.trigger.kind === "trainer") {
    const idx = side.hand.findIndex((c) => c.id === move.sourceId);
    if (idx < 0) return;
    const cardInstance = side.hand[idx];
    side.hand.splice(idx, 1);
    if (isSupporter(cardInstance)) side.supporterPlayedThisTurn = true;
    side.discard.push(cardInstance); // the trainer itself
  }

  const targets = resolveTargets(state, actor, effect, move);
  const ctx: OpContext = { state, actor, targets, rng };
  applyOps(effect.ops, ctx);

  if (effect.trigger.kind === "activated" || effect.trigger.kind === "on_play") {
    const mon = [side.active, ...side.bench].find((m) => m?.id === move.sourceId);
    if (mon && effect.ability) mon.abilitiesUsedThisTurn.push(effect.ability);
  }
}
