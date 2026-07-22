// Pokémon Tools — attached to a Pokémon (one at a time) for a passive
// effect. Declarative registry keyed by exact card name; unregistered
// tools attach and sit inertly (still discarded with the Pokémon on KO).
//
// The mechanically-impactful staples are retreat-cost and max-HP modifiers;
// those are read wherever the rule is applied (retreatCost, effectiveMaxHp).

import type { CardInstance, GameState, PokemonInPlay } from "../types";
import { isNsPokemon, totalEnergyUnits } from "./setup";

export interface ToolEffect {
  /** Reduces Retreat Cost by this many Colorless (floored at 0). */
  retreatReduction?: number;
  /** Adds this much max HP while attached. */
  hpBonus?: number;
}

const TOOL_EFFECTS: Record<string, ToolEffect> = {
  "Air Balloon": { retreatReduction: 2 },
  // Binding Mochi: +30 HP (Standard printing).
  "Binding Mochi": { hpBonus: 30 },
  // Bravery Charm: +50 HP.
  "Bravery Charm": { hpBonus: 50 },
};

export function isTool(card: CardInstance): boolean {
  return (
    card.catalog?.supertype === "Trainer" &&
    (card.catalog.subtypes.includes("Pokémon Tool") || card.catalog.subtypes.includes("Tool"))
  );
}

function toolEffects(mon: PokemonInPlay): ToolEffect[] {
  return mon.attachedTools
    .map((t) => TOOL_EFFECTS[t.name])
    .filter((e): e is ToolEffect => e != null);
}

/** N's Castle: N's Pokémon in play (both players) have no Retreat Cost. A
 *  passive Stadium effect, so it's read here where retreat cost is applied
 *  rather than via an activated stadium move. */
function stadiumWaivesRetreat(mon: PokemonInPlay, state?: GameState): boolean {
  return state?.stadium?.card.name === "N's Castle" && isNsPokemon(mon.card);
}

/** Retreat cost in Colorless after tool reductions and passive Stadium
 *  effects (floored at 0). Pass `state` so Stadium waivers apply. */
export function retreatCost(mon: PokemonInPlay, state?: GameState): number {
  if (stadiumWaivesRetreat(mon, state)) return 0;
  const base = mon.card.catalog?.retreat_cost ?? 0;
  const reduction = toolEffects(mon).reduce((n, e) => n + (e.retreatReduction ?? 0), 0);
  return Math.max(0, base - reduction);
}

/** Whether the Pokémon has enough attached Energy units to retreat. */
export function canRetreat(mon: PokemonInPlay, state?: GameState): boolean {
  return totalEnergyUnits(mon) >= retreatCost(mon, state);
}

/** Max HP including tool bonuses (Binding Mochi, Bravery Charm). */
export function effectiveMaxHp(mon: PokemonInPlay): number {
  const base = mon.card.catalog?.hp ?? 120;
  return base + toolEffects(mon).reduce((n, e) => n + (e.hpBonus ?? 0), 0);
}
