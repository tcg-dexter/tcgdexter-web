// Attack effects for staple attackers. Keyed by "CardName::AttackName".
// Two kinds of effect:
//   * damage scaling — the printed "180+" / "30×" damage depends on game
//     state (prizes taken, energy in discard). Resolved into a concrete
//     number applied to the ACTIVE (Weakness/Resistance still apply there).
//   * placement — after the active is hit, the attack puts damage counters
//     or raw damage on the opponent's BENCH (no Weakness/Resistance), and
//     may discard the attacker's own Energy.
//
// The player choosing bench targets supplies them on the attack move
// (benchCounters / benchDamageTargets); the AI allocates heuristically.

import type { CardInstance, GameState, PokemonInPlay } from "../types";
import { baseDamage } from "./moves";
import { isBasicEnergyCard } from "./setup";

/* ─── Damage scaling ────────────────────────────────────────────── */

type DamageScaler = (state: GameState, actor: "player" | "opponent") => number;

const DAMAGE_SCALERS: Record<string, DamageScaler> = {
  // Burning Darkness: 180 + 30 for each Prize the opponent has taken.
  "Charizard ex::Burning Darkness": (state, actor) => {
    const oppTaken = state.prizesTaken[actor === "player" ? "opponent" : "player"];
    return 180 + 30 * oppTaken;
  },
  // Back Draft: 30 for each Basic Energy in the opponent's discard pile.
  "N's Darmanitan::Back Draft": (state, actor) => {
    const opp = state.sides[actor === "player" ? "opponent" : "player"];
    return 30 * opp.discard.filter(isBasicEnergyCard).length;
  },
};

/** Base damage to the active before Weakness/Resistance — scaled when the
 *  attack's damage depends on game state, else the printed number. */
export function attackBaseDamage(
  state: GameState,
  actor: "player" | "opponent",
  attacker: PokemonInPlay,
  attackIndex: number,
): number {
  const attack = attacker.card.catalog?.attacks[attackIndex];
  if (!attack) return 0;
  const scaler = DAMAGE_SCALERS[`${attacker.card.name}::${attack.name}`];
  return scaler ? scaler(state, actor) : baseDamage(attack);
}

/* ─── Flat damage bonuses to the Active (before Weakness/Resistance) ─ */

/** Extra damage added to the Active-spot hit before Weakness/Resistance,
 *  from turn-scoped supporters and attacker-side tool/condition combos.
 *  Never applies to Bench placement damage. */
export function activeDamageBonus(
  state: GameState,
  actor: "player" | "opponent",
  attacker: PokemonInPlay,
  defender: PokemonInPlay,
): number {
  let bonus = 0;
  // Black Belt's Training: +40 to the opponent's Active Pokémon ex, the turn
  // it is played.
  const defIsEx = defender.card.catalog?.subtypes.includes("ex") ?? false;
  if (state.sides[actor].blackBeltTrainingTurn === state.turn.number && defIsEx) {
    bonus += 40;
  }
  // Binding Mochi (PRE 95): while the attached attacker is Poisoned, its
  // attacks do 40 more to the opponent's Active.
  if (
    attacker.conditions.includes("Poisoned") &&
    attacker.attachedTools.some((t) => t.name === "Binding Mochi")
  ) {
    bonus += 40;
  }
  return bonus;
}

/* ─── Placement / side effects ──────────────────────────────────── */

export type AttackEffect =
  /** Put N damage counters on the opponent's Benched Pokémon, any way. */
  | { kind: "bench_counters"; counters: number }
  /** Deal `amount` raw damage to 1 Benched Pokémon; optionally discard all
   *  Energy from the attacker first. */
  | { kind: "bench_damage"; amount: number; targets: number; discardSelfEnergy?: boolean };

const ATTACK_EFFECTS: Record<string, AttackEffect> = {
  // Phantom Dive: put 6 damage counters on the opponent's Bench, any way.
  "Dragapult ex::Phantom Dive": { kind: "bench_counters", counters: 6 },
  // Flamebody Cannon: discard all Energy from this Pokémon; 90 to 1 Bench.
  "N's Darmanitan::Flamebody Cannon": {
    kind: "bench_damage",
    amount: 90,
    targets: 1,
    discardSelfEnergy: true,
  },
};

/** Effect-coverage predicate (W1): does this attack have a modeled damage
 *  scaler or placement/side effect? (Attack-inflicted conditions and
 *  self-clear are checked separately in conditions.ts.) */
export function isAttackModeled(cardName: string, attackName: string): boolean {
  const key = `${cardName}::${attackName}`;
  return key in DAMAGE_SCALERS || key in ATTACK_EFFECTS;
}

export function attackEffect(attacker: PokemonInPlay, attackIndex: number): AttackEffect | null {
  const attack = attacker.card.catalog?.attacks[attackIndex];
  if (!attack) return null;
  return ATTACK_EFFECTS[`${attacker.card.name}::${attack.name}`] ?? null;
}

/** How many bench damage counters this attack asks the player to place
 *  (0 when it has no placement effect). Drives the UI/validation. */
export function attackBenchCounterCount(attacker: PokemonInPlay, attackIndex: number): number {
  const eff = attackEffect(attacker, attackIndex);
  return eff?.kind === "bench_counters" ? eff.counters : 0;
}

export function attackBenchDamageTargets(attacker: PokemonInPlay, attackIndex: number): number {
  const eff = attackEffect(attacker, attackIndex);
  return eff?.kind === "bench_damage" ? eff.targets : 0;
}

/** Discard all Energy from a Pokémon (Flamebody Cannon cost). */
export function discardAllEnergy(mon: PokemonInPlay, discard: CardInstance[]): void {
  discard.push(...mon.attachedEnergy);
  mon.attachedEnergy = [];
}
