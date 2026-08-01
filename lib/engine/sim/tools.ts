// Pokémon Tools — attached to a Pokémon (one at a time) for a passive
// effect. Declarative registry keyed by exact card name; unregistered
// tools attach and sit inertly (still discarded with the Pokémon on KO).
//
// The mechanically-impactful staples are retreat-cost and max-HP modifiers;
// those are read wherever the rule is applied (retreatCost, effectiveMaxHp).

import type { CardInstance, GameState, PokemonInPlay } from "../types";
import { isNsPokemon, totalEnergyUnits } from "./setup";
import { specialEnergyHpBonus } from "./effects/energy";
import { stadiumDisablesTools, stadiumHpDelta } from "./stadiums";
import { hasStatus, statusAmount } from "./statuses";
import { auraWaivesRetreat } from "./auras";

export interface ToolEffect {
  /** Reduces Retreat Cost by this many Colorless (floored at 0). */
  retreatReduction?: number;
  /** Adds this much max HP while attached. */
  hpBonus?: number;
  /** Extra damage to the opponent's ACTIVE, before Weakness/Resistance. */
  damageBonus?: {
    amount: number;
    /** Only against a defending Pokémon ex. */
    vsEx?: boolean;
    /** Only if the HOLDER has no rule box (Brave Bangle). */
    holderNoRuleBox?: boolean;
    /** Only if the holder's name starts with this (Hop's Choice Band). */
    holderNamePrefix?: string;
  };
  /** Attacks cost this many fewer Colorless. */
  costReduction?: {
    amount: number;
    /** Only while holding a prize lead (Counter Gain). */
    whenPrizeLead?: boolean;
    /** Only for holders with this subtype (Sparkling Crystal: Tera). */
    holderSubtype?: string;
    holderNamePrefix?: string;
  };
}

const TOOL_EFFECTS: Record<string, ToolEffect> = {
  "Air Balloon": { retreatReduction: 2 },
  // Binding Mochi: +30 HP (Standard printing).
  "Binding Mochi": { hpBonus: 30 },
  // Bravery Charm: +50 HP.
  "Bravery Charm": { hpBonus: 50 },
  "Hero's Cape": { hpBonus: 100 },
  "Cynthia's Power Weight": { hpBonus: 70 },
  "Vitality Band": { damageBonus: { amount: 10 } },
  "Maximum Belt": { damageBonus: { amount: 50, vsEx: true } },
  // Brave Bangle: +30 vs an Active ex, but only on a holder with no rule box.
  "Brave Bangle": { damageBonus: { amount: 30, vsEx: true, holderNoRuleBox: true } },
  // Hop's Choice Band does BOTH: costs 1 less and hits 30 harder.
  "Hop's Choice Band": {
    damageBonus: { amount: 30, holderNamePrefix: "Hop's " },
    costReduction: { amount: 1, holderNamePrefix: "Hop's " },
  },
  "Counter Gain": { costReduction: { amount: 1, whenPrizeLead: true } },
  "Sparkling Crystal": { costReduction: { amount: 1, holderSubtype: "Tera" } },
  // Prize reduction is applied at the knockout site (damage.ts); the empty
  // effect here records that the card IS modeled.
  "Lillie's Pearl": {},
  // Effects live in effects/cards.ts as on_damaged / end_of_turn triggers.
  "Lucky Helmet": {},
  "Handheld Fan": {},
  Powerglass: {},
};

const RULE_BOX = /\b(ex|EX|V|VMAX|VSTAR)\b/;

/** Extra Active-spot damage from attached Tools, before Weakness/Resistance. */
export function toolDamageBonus(
  attacker: PokemonInPlay,
  defender: PokemonInPlay,
  state?: GameState,
): number {
  let bonus = 0;
  for (const e of toolEffects(attacker, state)) {
    const d = e.damageBonus;
    if (!d) continue;
    if (d.vsEx && !(defender.card.catalog?.subtypes.includes("ex") ?? false)) continue;
    if (d.holderNoRuleBox && RULE_BOX.test(attacker.card.name)) continue;
    if (d.holderNamePrefix && !attacker.card.name.startsWith(d.holderNamePrefix)) continue;
    bonus += d.amount;
  }
  return bonus;
}

/** Colorless removed from this Pokémon's attack costs by attached Tools. */
export function toolCostReduction(
  mon: PokemonInPlay,
  state?: GameState,
  hasPrizeLead = false,
): number {
  let cut = 0;
  for (const e of toolEffects(mon, state)) {
    const c = e.costReduction;
    if (!c) continue;
    if (c.whenPrizeLead && !hasPrizeLead) continue;
    if (c.holderSubtype && !(mon.card.catalog?.subtypes.includes(c.holderSubtype) ?? false)) continue;
    if (c.holderNamePrefix && !mon.card.name.startsWith(c.holderNamePrefix)) continue;
    cut += c.amount;
  }
  return cut;
}

/** Effect-coverage predicate (W1): does this Tool have a modeled effect? */
export function isToolModeled(name: string): boolean {
  return name in TOOL_EFFECTS;
}

export function isTool(card: CardInstance): boolean {
  return (
    card.catalog?.supertype === "Trainer" &&
    (card.catalog.subtypes.includes("Pokémon Tool") || card.catalog.subtypes.includes("Tool"))
  );
}

function toolEffects(mon: PokemonInPlay, state?: GameState): ToolEffect[] {
  // Jamming Tower: attached Tools have no effect at all.
  if (stadiumDisablesTools(state)) return [];
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
  if (stadiumWaivesRetreat(mon, state) || auraWaivesRetreat(mon, state)) return 0;
  const base = mon.card.catalog?.retreat_cost ?? 0;
  const reduction = toolEffects(mon, state).reduce((n, e) => n + (e.retreatReduction ?? 0), 0);
  return Math.max(0, base - reduction + statusAmount(mon, "retreat_cost_extra", state));
}

/** Whether the Pokémon has enough attached Energy units to retreat. */
export function canRetreat(mon: PokemonInPlay, state?: GameState): boolean {
  // "During your opponent's next turn, the Defending Pokémon can't retreat."
  if (hasStatus(mon, "cannot_retreat", state)) return false;
  return totalEnergyUnits(mon) >= retreatCost(mon, state);
}

/** Max HP including tool bonuses (Binding Mochi, Bravery Charm). */
export function effectiveMaxHp(mon: PokemonInPlay, state?: GameState): number {
  const base = mon.card.catalog?.hp ?? 120;
  return Math.max(
    10,
    base +
      toolEffects(mon, state).reduce((n, e) => n + (e.hpBonus ?? 0), 0) +
      specialEnergyHpBonus(mon) + // Growing Grass Energy
      stadiumHpDelta(mon, state), // Gravity Mountain
  );
}
