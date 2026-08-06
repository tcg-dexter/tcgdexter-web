// Attack placement / self-cost effects, keyed by "CardName::AttackName".
//
// Its own module for the same reason effects/copy.ts is: BOTH the attack path
// and the COPY path need this table, and they cannot import each other.
// `attacks.ts` -> `effects/runtime.ts` -> `effects/primitives.ts` is already a
// chain, so primitives importing attacks.ts back would cycle. Anything both
// halves need lives low, in its own file (see also effects/match.ts,
// effects/guards.ts).
//
// Why the copy path needs it at all: "use it as this attack" brings the
// attack's WHOLE text along, not just its printed number. N's Zoroark ex
// copying N's Darmanitan's Flamebody Cannon must discard N's Zoroark's Energy
// and hit the opponent's Bench for 90, exactly as using it directly would.
// Without that, copying was strictly better than the original.
//
// The player supplies bench targets on the attack move (benchCounters /
// benchDamageTargets); the AI allocates heuristically in damage.ts.

import type { CardInstance, PokemonInPlay } from "../../types";

export type AttackEffect =
  /** Put N damage counters on the opponent's Benched Pokémon, any way. */
  | { kind: "bench_counters"; counters: number }
  /** Deal `amount` raw damage to `targets` Benched Pokémon; optionally
   *  discard all Energy from the attacker first. */
  | { kind: "bench_damage"; amount: number; targets: number; discardSelfEnergy?: boolean };

export const ATTACK_EFFECTS: Record<string, AttackEffect> = {
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

/** The placement effect of an attack named on any card — the form the copy
 *  path and the UI need, neither of which holds the donor as a PokemonInPlay
 *  at the point it has to ask. */
export function attackPlacement(cardName: string, attackName: string): AttackEffect | null {
  return ATTACK_EFFECTS[`${cardName}::${attackName}`] ?? null;
}

export function attackEffect(attacker: PokemonInPlay, attackIndex: number): AttackEffect | null {
  const attack = attacker.card.catalog?.attacks[attackIndex];
  if (!attack) return null;
  return attackPlacement(attacker.card.name, attack.name);
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

/** Discard all Energy from a Pokémon (Flamebody Cannon's cost). Note the
 *  card says "this Pokémon", so when the attack is COPIED this discards the
 *  copier's Energy, not the donor's. */
export function discardAllEnergy(mon: PokemonInPlay, discard: CardInstance[]): void {
  discard.push(...mon.attachedEnergy);
  mon.attachedEnergy = [];
}
