// Legal-move generation for the free-running simulator. Encodes the core
// turn-structure rules: one energy attachment per turn, evolution lock,
// no attacking on the game's first turn, one retreat per turn, bench cap,
// supporter once per turn. Trainer effects are generalized to cycling
// (see setup.ts header).

import type { EngineAttack, GameState, PlayerSide, PokemonInPlay } from "../types";
import { energyProvides, energyUnits, isBasic } from "./setup";
import { isSupporter, trainerMoves, trainerSpec, type PlayTrainerMove } from "./trainers";
import { abilityMoves, type UseAbilityMove } from "./abilities";
import { cannotAct } from "./conditions";
import { canRetreat, effectiveMaxHp, isTool } from "./tools";
import { benchCap, stadiumMoves, type UseStadiumMove } from "./stadiums";
import type { EffectMove } from "./effects/runtime";

export type SimMove =
  | { kind: "attach"; cardId: string; targetId: string }
  | { kind: "bench"; cardId: string }
  | { kind: "evolve"; cardId: string; targetId: string }
  | { kind: "retreat"; benchIndex: number }
  | { kind: "cycle_supporter"; cardId: string }
  | { kind: "cycle_item"; cardId: string }
  | PlayTrainerMove
  | UseAbilityMove
  // Universal declarative-effect move (W2 cutover). Card-agnostic: the source
  // is a hand card (trainer) or an in-play Pokémon (ability); `picks` records
  // the chosen ids per target slot. Enumerated by enumerateEffect for cards in
  // the declarative registry (effects/cards.ts); applied by applyEffect.
  | EffectMove
  | { kind: "play_stadium"; cardId: string }
  | { kind: "attach_tool"; cardId: string; targetId: string }
  | UseStadiumMove
  | {
      kind: "attack";
      attackIndex: number;
      /** Opponent-bench monIds, one per counter placed (Phantom Dive). */
      benchCounters?: string[];
      /** Opponent-bench monIds hit by bench damage (Flamebody Cannon). */
      benchDamageTargets?: string[];
    }
  | { kind: "pass" };

/** Per-turn bookkeeping the PlayerSide shape doesn't carry (replay never
 *  needed it): the acting side's single retreat per turn. */
export interface TurnContext {
  retreated: boolean;
  /** The current Stadium's activated effect was used this turn (Artazon). */
  stadiumUsed?: boolean;
  /** A Stadium card was played this turn (one per turn). */
  stadiumPlayed?: boolean;
}

export function sideOf(state: GameState, actor: "player" | "opponent"): PlayerSide {
  return state.sides[actor];
}

/* ─── Energy cost satisfaction ──────────────────────────────────── */

/** Greedy typed-cost check: typed requirements consume matching attached
 *  energy first, Colorless consumes whatever remains. */
export function canPayCost(mon: PokemonInPlay, cost: string[]): boolean {
  if (cost.length === 0) return true;
  // One card can provide several units (Double Turbo = 2) and a unit can be
  // a wildcard "Any" (Luminous) that pays any typed requirement.
  const pool = mon.attachedEnergy.flatMap(energyUnits);
  if (pool.length < cost.length) return false;

  // Typed requirements first: prefer an exact-type unit, fall back to "Any".
  for (const req of cost) {
    if (req === "Colorless") continue;
    let idx = pool.indexOf(req);
    if (idx === -1) idx = pool.indexOf("Any");
    if (idx === -1) return false;
    pool.splice(idx, 1);
  }
  const colorless = cost.filter((c) => c === "Colorless").length;
  return pool.length >= colorless; // Colorless pays from anything left
}

export function usableAttacks(mon: PokemonInPlay): { attack: EngineAttack; index: number }[] {
  const attacks = mon.card.catalog?.attacks ?? [];
  return attacks
    .map((attack, index) => ({ attack, index }))
    .filter(({ attack }) => canPayCost(mon, attack.cost));
}

/* ─── Damage math ───────────────────────────────────────────────── */

/** Printed damage number ("180+", "30×" → 180, 30; text-only → 0). */
export function baseDamage(attack: EngineAttack): number {
  const n = parseInt(attack.damage, 10);
  return Number.isFinite(n) ? n : 0;
}

export function remainingHp(mon: PokemonInPlay): number {
  return effectiveMaxHp(mon) - mon.damage;
}

/** Apply Weakness (×2) / Resistance (−30) for the attacker's type against a
 *  defending ACTIVE. Damage to Benched Pokémon and damage counters never
 *  call this (core rule). Floored at 0. */
export function applyWeaknessResistance(
  base: number,
  attacker: PokemonInPlay,
  defender: PokemonInPlay,
): number {
  if (base <= 0) return 0;
  let dmg = base;
  const attackerType = attacker.card.catalog?.types[0];
  const defCatalog = defender.card.catalog;
  if (attackerType && defCatalog) {
    if (defCatalog.weaknesses.some((w) => w.type === attackerType)) dmg *= 2;
    if (defCatalog.resistances.some((r) => r.type === attackerType)) dmg = Math.max(0, dmg - 30);
  }
  return dmg;
}

/** Fraction of an attack's cost payable right now — the typed mirror of
 *  canPayCost. Count-based progress credited dead energy: a Psychic on a
 *  Lightning attacker read as investment, so the planner happily banked
 *  energy its attacker could never spend. Shared by the planner's
 *  investment term and the ML state encoder (schema v3). */
export function costProgress(mon: PokemonInPlay, cost: string[]): number {
  if (cost.length === 0) return 0;
  const pool = mon.attachedEnergy.flatMap(energyUnits);
  let paid = 0;
  for (const req of cost) {
    if (req === "Colorless") continue;
    let idx = pool.indexOf(req);
    if (idx === -1) idx = pool.indexOf("Any");
    if (idx === -1) continue;
    pool.splice(idx, 1);
    paid += 1;
  }
  const colorless = cost.filter((c) => c === "Colorless").length;
  paid += Math.min(pool.length, colorless);
  return paid / cost.length;
}

/** v1 damage model: printed number + weakness/resistance. Attacks with
 *  state-scaled damage (Burning Darkness, Back Draft) go through
 *  attackBaseDamage in attacks.ts before this; plain attacks use the
 *  printed number here. */
export function computeDamage(
  attacker: PokemonInPlay,
  attack: EngineAttack,
  defender: PokemonInPlay,
): number {
  return applyWeaknessResistance(baseDamage(attack), attacker, defender);
}

/* ─── Evolution eligibility ─────────────────────────────────────── */

export function evolutionTargets(
  side: PlayerSide,
  evolvesFrom: string,
  turnNumber: number,
): PokemonInPlay[] {
  const inPlay = [side.active, ...side.bench].filter(
    (m): m is PokemonInPlay => m !== null,
  );
  return inPlay.filter(
    (mon) =>
      mon.card.name === evolvesFrom &&
      mon.enteredPlayOnTurn < turnNumber &&
      !mon.evolvedThisTurn,
  );
}

/* ─── Legal moves ───────────────────────────────────────────────── */

export function legalMoves(
  state: GameState,
  actor: "player" | "opponent",
  ctx: TurnContext,
): SimMove[] {
  const side = sideOf(state, actor);
  const moves: SimMove[] = [];
  const inPlay = [side.active, ...side.bench].filter(
    (m): m is PokemonInPlay => m !== null,
  );

  // A player cannot evolve on their own first turn of the game (global
  // turns 1 and 2). Per-mon "in play since last turn" is enforced in
  // evolutionTargets; this is the additional game-opening ban.
  const canEvolve = state.turn.playerTurnNumber > 1;
  // The very first turn of the game bans Supporters outright.
  const supporterBanned = state.turn.number === 1;

  const cap = benchCap(state, actor);
  for (const card of side.hand) {
    // Bench a basic.
    if (isBasic(card) && side.bench.length < cap) {
      moves.push({ kind: "bench", cardId: card.id });
    }
    // Evolve.
    const from = card.catalog?.evolves_from;
    if (from && canEvolve) {
      for (const target of evolutionTargets(side, from, state.turn.number)) {
        moves.push({ kind: "evolve", cardId: card.id, targetId: target.id });
      }
    }
    // Attach energy (one per turn).
    if (side.energyAttachedThisTurn === 0 && energyProvides(card) !== null) {
      for (const target of inPlay) {
        moves.push({ kind: "attach", cardId: card.id, targetId: target.id });
      }
    }
    // Stadium: one per turn, into play, unless one of the same name already
    // is (you may not replace a Stadium with an identical one).
    if (card.catalog?.supertype === "Trainer" && card.catalog.subtypes.includes("Stadium")) {
      if (!ctx.stadiumPlayed && state.stadium?.card.name !== card.name) {
        moves.push({ kind: "play_stadium", cardId: card.id });
      }
      continue;
    }
    // Pokémon Tool: attach to a Pokémon that isn't already holding one.
    if (isTool(card)) {
      for (const target of inPlay) {
        if (target.attachedTools.length === 0) {
          moves.push({ kind: "attach_tool", cardId: card.id, targetId: target.id });
        }
      }
      continue;
    }
    // Trainers: registered staples get their real effect; anything else
    // keeps the generic draw-cycle behavior.
    if (card.catalog?.supertype === "Trainer") {
      const supporter = isSupporter(card);
      const supporterOk = !supporter || (!side.supporterPlayedThisTurn && !supporterBanned);
      const spec = trainerSpec(card);
      if (spec) {
        if (supporterOk) {
          moves.push(...trainerMoves(state, actor, card, spec));
        }
      } else if (side.deck.length > 0) {
        if (supporter) {
          if (supporterOk) {
            moves.push({ kind: "cycle_supporter", cardId: card.id });
          }
        } else {
          moves.push({ kind: "cycle_item", cardId: card.id });
        }
      }
    }
  }

  // Activated abilities (once per turn per Pokémon; conditions checked).
  moves.push(...abilityMoves(state, actor));

  // Activated Stadium effect (Artazon), once per turn.
  moves.push(...stadiumMoves(state, actor, ctx.stadiumUsed ?? false));

  // Asleep / Paralyzed active can neither attack nor retreat this turn.
  const activeCanAct = side.active ? !cannotAct(side.active) : false;

  // Retreat (once per turn, cost payable, somewhere to go).
  if (
    activeCanAct &&
    !ctx.retreated &&
    side.active &&
    side.bench.length > 0 &&
    canRetreat(side.active, state)
  ) {
    for (let i = 0; i < side.bench.length; i++) {
      moves.push({ kind: "retreat", benchIndex: i });
    }
  }

  // Attack (ends the turn). Nobody attacks on the game's very first turn.
  if (activeCanAct && side.active && state.turn.number > 1) {
    for (const { index } of usableAttacks(side.active)) {
      moves.push({ kind: "attack", attackIndex: index });
    }
  }

  moves.push({ kind: "pass" });
  return moves;
}
