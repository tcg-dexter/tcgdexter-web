// Legal-move generation for the free-running simulator. Encodes the core
// turn-structure rules: one energy attachment per turn, evolution lock,
// no attacking on the game's first turn, one retreat per turn, bench cap,
// supporter once per turn. Trainer effects are generalized to cycling
// (see setup.ts header).

import type { EngineAttack, GameState, PlayerSide, PokemonInPlay } from "../types";
import { energyProvides, isBasic } from "./setup";

export type SimMove =
  | { kind: "attach"; cardId: string; targetId: string }
  | { kind: "bench"; cardId: string }
  | { kind: "evolve"; cardId: string; targetId: string }
  | { kind: "retreat"; benchIndex: number }
  | { kind: "cycle_supporter"; cardId: string }
  | { kind: "cycle_item"; cardId: string }
  | { kind: "attack"; attackIndex: number }
  | { kind: "pass" };

/** Per-turn bookkeeping the PlayerSide shape doesn't carry (replay never
 *  needed it): the acting side's single retreat per turn. */
export interface TurnContext {
  retreated: boolean;
}

export function sideOf(state: GameState, actor: "player" | "opponent"): PlayerSide {
  return state.sides[actor];
}

/* ─── Energy cost satisfaction ──────────────────────────────────── */

/** Greedy typed-cost check: typed requirements consume matching attached
 *  energy first, Colorless consumes whatever remains. */
export function canPayCost(mon: PokemonInPlay, cost: string[]): boolean {
  if (cost.length === 0) return true;
  const provides = mon.attachedEnergy
    .map(energyProvides)
    .filter((t): t is string => t !== null);
  if (provides.length < cost.length) return false;

  const pool = [...provides];
  for (const req of cost) {
    if (req === "Colorless") continue; // consumed after typed reqs
    const idx = pool.indexOf(req);
    if (idx === -1) return false;
    pool.splice(idx, 1);
  }
  const colorless = cost.filter((c) => c === "Colorless").length;
  return pool.length >= colorless;
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

/** HP when the catalog missed — mid-range so unknowns aren't unkillable. */
const FALLBACK_HP = 120;

export function remainingHp(mon: PokemonInPlay): number {
  return (mon.card.catalog?.hp ?? FALLBACK_HP) - mon.damage;
}

/** v1 damage model: printed number, weakness ×2, resistance −30, floor 0.
 *  Attack side-effects and ability modifiers are out of scope. */
export function computeDamage(
  attacker: PokemonInPlay,
  attack: EngineAttack,
  defender: PokemonInPlay,
): number {
  let dmg = baseDamage(attack);
  if (dmg === 0) return 0;
  const attackerType = attacker.card.catalog?.types[0];
  const defCatalog = defender.card.catalog;
  if (attackerType && defCatalog) {
    if (defCatalog.weaknesses.some((w) => w.type === attackerType)) dmg *= 2;
    if (defCatalog.resistances.some((r) => r.type === attackerType)) dmg = Math.max(0, dmg - 30);
  }
  return dmg;
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

  for (const card of side.hand) {
    // Bench a basic.
    if (isBasic(card) && side.bench.length < 5) {
      moves.push({ kind: "bench", cardId: card.id });
    }
    // Evolve.
    const from = card.catalog?.evolves_from;
    if (from) {
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
    // Generic trainer cycling.
    if (card.catalog?.supertype === "Trainer" && side.deck.length > 0) {
      if (card.catalog.subtypes.includes("Supporter")) {
        if (!side.supporterPlayedThisTurn) {
          moves.push({ kind: "cycle_supporter", cardId: card.id });
        }
      } else {
        moves.push({ kind: "cycle_item", cardId: card.id });
      }
    }
  }

  // Retreat (once per turn, cost payable, somewhere to go).
  if (
    !ctx.retreated &&
    side.active &&
    side.bench.length > 0 &&
    side.active.attachedEnergy.length >= (side.active.card.catalog?.retreat_cost ?? 0)
  ) {
    for (let i = 0; i < side.bench.length; i++) {
      moves.push({ kind: "retreat", benchIndex: i });
    }
  }

  // Attack (ends the turn). Nobody attacks on the game's very first turn.
  if (side.active && state.turn.number > 1) {
    for (const { index } of usableAttacks(side.active)) {
      moves.push({ kind: "attack", attackIndex: index });
    }
  }

  moves.push({ kind: "pass" });
  return moves;
}
