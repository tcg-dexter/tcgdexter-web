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
import type { Rng } from "./rng";
import { damageScaleEffect } from "./effects/cards";
import { evalDamageFormula } from "./effects/runtime";

/* ─── Damage scaling ────────────────────────────────────────────── */

// The hand-written DAMAGE_SCALERS registry is GONE (W2-fin.3): Burning
// Darkness and Back Draft now live in effects/cards.ts as `damage_scale`
// records, alongside the rest of the field. Scaling is data, not a closure.

/** Base damage to the active before Weakness/Resistance — computed from the
 *  attack's declarative damage formula when it has one, else the printed
 *  number. `rng` is consumed only by flip-until-tails formulas, and this is
 *  called once, at real damage resolution (the AI's move evaluation uses the
 *  printed number via baseDamage, so the rng stream stays deterministic). */
export function attackBaseDamage(
  state: GameState,
  actor: "player" | "opponent",
  attacker: PokemonInPlay,
  attackIndex: number,
  rng: Rng | null = null,
): number {
  const attack = attacker.card.catalog?.attacks[attackIndex];
  if (!attack) return 0;
  const scaled = damageScaleEffect(attacker.card.name, attack.name);
  return scaled?.damage
    ? evalDamageFormula(state, actor, attacker, scaled.damage, rng)
    : baseDamage(attack);
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
  return (
    `${cardName}::${attackName}` in ATTACK_EFFECTS ||
    damageScaleEffect(cardName, attackName) !== null
  );
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
