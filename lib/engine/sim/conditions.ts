// Special conditions. Only the ACTIVE Pokémon can be affected (conditions
// clear the moment a Pokémon leaves the Active Spot — retreat, switch,
// gust, promotion — or evolves). Between turns, the Pokémon Checkup
// resolves them:
//   * Poisoned — 1 damage counter (10).
//   * Burned   — 2 damage counters (20), then a coin flip; heads recovers.
//   * Asleep   — coin flip; heads wakes up. Can't attack or retreat.
//   * Paralyzed— can't attack or retreat; removed at the Checkup after the
//                affected player's own turn.
//   * Confused — on attacking, coin flip; tails puts 30 on itself and the
//                attack fails. (Confused may still retreat.)
//
// Poison/Burn/Sleep/Confusion stack conceptually, but only one of
// Asleep/Paralyzed/Confused can be on a Pokémon at once (they replace each
// other); Poisoned and Burned coexist with those. We keep the array simple
// and let application replace the mutually-exclusive group.

import type { GameState, PokemonInPlay } from "../types";
import { stadiumBlocksConditions } from "./stadiums";
import type { SpecialCondition } from "@/lib/battle-log/types";
import type { Rng } from "./rng";

const SLEEP_PAR_CONFUSE: SpecialCondition[] = ["Asleep", "Paralyzed", "Confused"];

export function hasCondition(mon: PokemonInPlay, c: SpecialCondition): boolean {
  return mon.conditions.includes(c);
}

/** Apply a condition to a Pokémon. Asleep/Paralyzed/Confused replace one
 *  another; Poisoned/Burned are added if not present. */
export function applyCondition(
  mon: PokemonInPlay,
  condition: SpecialCondition,
  state?: GameState,
): void {
  // Festival Grounds: a Pokémon with any Energy can't be affected by Special
  // Conditions at all (and existing ones are cleared).
  if (stadiumBlocksConditions(mon, state)) {
    mon.conditions = [];
    return;
  }
  if (SLEEP_PAR_CONFUSE.includes(condition)) {
    mon.conditions = mon.conditions.filter((c) => !SLEEP_PAR_CONFUSE.includes(c));
  }
  if (!mon.conditions.includes(condition)) mon.conditions.push(condition);
}

/** A Pokémon that is Asleep or Paralyzed cannot attack or retreat. */
export function cannotAct(mon: PokemonInPlay): boolean {
  return hasCondition(mon, "Asleep") || hasCondition(mon, "Paralyzed");
}

/** Conditions clear when a Pokémon leaves the Active Spot or evolves. */
export function clearConditions(mon: PokemonInPlay): void {
  if (mon.conditions.length > 0) mon.conditions = [];
}

/**
 * Pokémon Checkup between turns. `justActed` is the player whose turn just
 * ended — their Paralysis clears here (it lasted through their turn). Poison
 * and Burn place damage; Sleep and Burn flip coins. Call resolveKnockouts
 * after (the driver does). rng drives the coin flips.
 */
export function runCheckup(state: GameState, justActed: "player" | "opponent", rng: Rng): void {
  for (const actor of ["player", "opponent"] as const) {
    const active = state.sides[actor].active;
    if (!active) continue;

    if (hasCondition(active, "Poisoned")) active.damage += 10;
    if (hasCondition(active, "Burned")) {
      active.damage += 20;
      if (rng() < 0.5) active.conditions = active.conditions.filter((c) => c !== "Burned");
    }
    if (hasCondition(active, "Asleep") && rng() < 0.5) {
      active.conditions = active.conditions.filter((c) => c !== "Asleep");
    }
    // Paralysis wears off at the Checkup following the paralyzed player's
    // own turn (they've now spent a turn unable to act).
    if (actor === justActed && hasCondition(active, "Paralyzed")) {
      active.conditions = active.conditions.filter((c) => c !== "Paralyzed");
    }
  }
}

/* ─── Attack-applied conditions (registry) ──────────────────────── */

/** What an attack inflicts on the DEFENDING active. `always` applies
 *  unconditionally; `onHeads`/`onTails` hang off a single coin flip. */
interface AttackConditionEffect {
  always?: SpecialCondition[];
  onHeads?: SpecialCondition[];
  onTails?: SpecialCondition[];
}

/** Keyed by "CardName::AttackName". Covers every condition-inflicting
 *  attack in the benchmark meta (audited 2026-07-21) — extend when the
 *  benchmark fixture rotates. */
const ATTACK_CONDITIONS: Record<string, AttackConditionEffect> = {
  "Munkidori::Mind Bend": { always: ["Confused"] },
  // "Flip a coin. If heads, ... Paralyzed and Poisoned. If tails, ... Confused."
  "Lilligant::Bemusing Aroma": { onHeads: ["Paralyzed", "Poisoned"], onTails: ["Confused"] },
  // "Flip a coin. If heads, ... Paralyzed."
  "Dedenne::Thunder Shock": { onHeads: ["Paralyzed"] },
};

/**
 * Conditions this attack inflicts on the defender. Without an rng (ghost
 * planning) the HEADS branch is assumed — the planner prices the attack's
 * upside, mirroring how the Confused self-flip is skipped without an rng;
 * the real driver always flips.
 */
export function attackInflictedConditions(
  attackerName: string,
  attackName: string,
  rng?: Rng,
): SpecialCondition[] {
  const effect = ATTACK_CONDITIONS[`${attackerName}::${attackName}`];
  if (!effect) return [];
  const out: SpecialCondition[] = [...(effect.always ?? [])];
  if (effect.onHeads || effect.onTails) {
    const heads = rng ? rng() < 0.5 : true;
    const branch = heads ? effect.onHeads : effect.onTails;
    if (branch) out.push(...branch);
  }
  return out;
}

/** Attacks whose user recovers from all Special Conditions on use. */
const SELF_CLEAR_ATTACKS = new Set(["Gardevoir ex::Miracle Force"]);
/** Effect-coverage predicate (W1): does this attack have a modeled inflicted
 *  condition or self-clear? */
export function attackConditionModeled(attackerName: string, attackName: string): boolean {
  const key = `${attackerName}::${attackName}`;
  return key in ATTACK_CONDITIONS || SELF_CLEAR_ATTACKS.has(key);
}

export function attackSelfClears(attackerName: string, attackName: string): boolean {
  return SELF_CLEAR_ATTACKS.has(`${attackerName}::${attackName}`);
}
