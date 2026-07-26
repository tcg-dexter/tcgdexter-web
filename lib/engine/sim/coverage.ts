// Effect-coverage classification (W1). Distinct from name-resolution coverage
// (coverageOf in replayView.ts): this asks whether a card's EFFECTS are
// actually modeled by the engine, not merely whether its name resolves in the
// catalog. A basic-energy-and-vanilla-attacker deck is fully covered; a deck
// leaning on unmodeled abilities/trainers/riders is not, even though every
// name resolves.
//
// A card contributes zero or more "effect slots". Vanilla cards (basic energy,
// a Basic Pokémon whose attacks are plain damage with no ability) contribute
// none and are simply "covered". Each slot is implemented or a gap.

import { lookupCard } from "../catalog";
import type { EngineCard } from "../types";
import { isSpecialEnergyModeled } from "./setup";
import { isAbilityModeled } from "./abilities";
import { isAttackModeled } from "./attacks";
import { attackConditionModeled } from "./conditions";
import { isStadiumModeled } from "./stadiums";
import { isToolModeled } from "./tools";
import { TRAINER_EFFECTS } from "./trainers";
import { effectsFor } from "./effects/cards";

export type EffectSlotKind =
  | "ability"
  | "attack_rider"
  | "damage_scale"
  | "trainer"
  | "stadium"
  | "tool"
  | "special_energy";

export interface EffectSlot {
  kind: EffectSlotKind;
  /** "Card::Ability" / "Card::Attack" for Pokémon effects, else the card name. */
  key: string;
  implemented: boolean;
}

/** Damage strings that depend on game state (×N per something, N+ under a
 *  condition) need a DAMAGE_SCALER; a plain number does not. */
function isScaledDamage(damage: string): boolean {
  return /[×x*+]/.test(damage ?? "");
}

function isToolCard(card: EngineCard): boolean {
  return card.subtypes.includes("Pokémon Tool") || card.subtypes.includes("Tool");
}

/** The effect slots a card contributes, each flagged implemented-or-gap.
 *  Empty for vanilla cards and for names not in the catalog (a separate
 *  concern surfaced as unknownNames upstream). */
export function classifyCardEffects(name: string): EffectSlot[] {
  const card = lookupCard(name);
  if (!card) return [];
  const slots: EffectSlot[] = [];

  if (card.supertype === "Pokémon") {
    for (const ability of card.abilities ?? []) {
      slots.push({
        kind: "ability",
        key: `${card.name}::${ability.name}`,
        implemented: isAbilityModeled(card.name, ability.name),
      });
    }
    for (const attack of card.attacks ?? []) {
      const scaled = isScaledDamage(attack.damage);
      const hasRider = (attack.text ?? "").trim().length > 0;
      if (!scaled && !hasRider) continue; // vanilla attack — just damage
      const implemented =
        isAttackModeled(card.name, attack.name) ||
        attackConditionModeled(card.name, attack.name);
      slots.push({
        kind: scaled ? "damage_scale" : "attack_rider",
        key: `${card.name}::${attack.name}`,
        implemented,
      });
    }
    return slots;
  }

  if (card.supertype === "Trainer") {
    if (isToolCard(card)) {
      slots.push({ kind: "tool", key: card.name, implemented: isToolModeled(card.name) });
    } else if (card.subtypes.includes("Stadium")) {
      slots.push({ kind: "stadium", key: card.name, implemented: isStadiumModeled(card.name) });
    } else {
      // Supporter / Item — effect-bearing by definition in Standard. Modeled
      // by the legacy registry OR the declarative registry (they're mutually
      // exclusive during the W2 migration; either counts as implemented).
      slots.push({
        kind: "trainer",
        key: card.name,
        implemented: card.name in TRAINER_EFFECTS || effectsFor(card.name).length > 0,
      });
    }
    return slots;
  }

  if (card.supertype === "Energy") {
    const isBasic = card.subtypes.includes("Basic") || card.name.startsWith("Basic ");
    if (!isBasic) {
      slots.push({
        kind: "special_energy",
        key: card.name,
        implemented: isSpecialEnergyModeled(card.name),
      });
    }
  }
  return slots;
}
