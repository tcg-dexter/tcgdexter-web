// Filter matchers for the declarative effect schema. Lives in its own module
// because BOTH layers need it — runtime.ts (enumerating candidates) and
// primitives.ts (ops like reveal_top that filter cards at apply time) — and
// runtime already imports primitives. Keeping the matchers here is what stops
// that from becoming a cycle.

import type { CardInstance, PokemonInPlay } from "../../types";
import { energyProvides, prizeValue } from "../setup";
import type { CardFilter, MonFilter } from "./types";

export function isBasicEnergyCard(c: CardInstance): boolean {
  return (
    c.catalog?.supertype === "Energy" &&
    (c.catalog.subtypes.includes("Basic") || c.name.startsWith("Basic "))
  );
}

/** Evolution stage of a Pokémon card, or null for non-Pokémon. */
function stageOf(c: CardInstance): "Basic" | "Stage 1" | "Stage 2" | null {
  const cat = c.catalog;
  if (cat?.supertype !== "Pokémon") return null;
  if (cat.subtypes.includes("Stage 2")) return "Stage 2";
  if (cat.subtypes.includes("Stage 1")) return "Stage 1";
  return cat.evolves_from ? null : "Basic";
}

export function cardMatches(c: CardInstance, f: CardFilter): boolean {
  const cat = c.catalog;
  if (!cat) return false;
  // `anyOf` is disjunctive; the sibling fields still apply on top of it.
  if (f.anyOf && !f.anyOf.some((sub) => cardMatches(c, sub))) return false;
  if (f.supertype && cat.supertype !== f.supertype) return false;
  if (f.subtype && !cat.subtypes.includes(f.subtype)) return false;
  if (f.basicPokemon && !(cat.supertype === "Pokémon" && !cat.evolves_from)) return false;
  if (f.stage && stageOf(c) !== f.stage) return false;
  if (f.basicEnergy && !isBasicEnergyCard(c)) return false;
  if (f.energyType && energyProvides(c) !== f.energyType) return false;
  if (f.pokemonType && !(cat.supertype === "Pokémon" && cat.types.includes(f.pokemonType))) {
    return false;
  }
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
  if (f.isEx && !(cat?.subtypes.includes("ex") ?? false)) return false;
  if (f.hasTool && mon.attachedTools.length === 0) return false;
  if (f.hasSpecialEnergy && !hasSpecialEnergy(mon)) return false;
  if (f.damaged && mon.damage < 10) return false;
  if (f.excludeName && mon.card.name === f.excludeName) return false;
  return true;
}
