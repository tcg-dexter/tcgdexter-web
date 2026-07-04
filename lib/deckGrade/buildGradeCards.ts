import { pickPrintingForCard, type Card } from "@/lib/cardPrinting";
import type { GradeCard } from "./types";

/** Deck-list energy symbol → elemental type. Mirrors the analyze route. */
const ENERGY_SYMBOL_TO_TYPE: Record<string, string> = {
  R: "Fire", W: "Water", G: "Grass", L: "Lightning",
  P: "Psychic", F: "Fighting", D: "Darkness", M: "Metal",
  Y: "Fairy", N: "Dragon", C: "Colorless",
};

/**
 * Adapt parsed deck cards + resolved printings into the pure grading engine's
 * `GradeCard[]` input. Resolves each line to its printing once and pulls the
 * fields the axes need (attack costs, effect text incl. Trainer rules, energy
 * type provided).
 */
export function buildGradeCards(cards: Card[]): GradeCard[] {
  return cards.map((c) => {
    const data = pickPrintingForCard(c);
    const subtypes = data?.subtypes ?? [];
    const supertype =
      data?.supertype ??
      (c.section === "pokemon"
        ? "Pokémon"
        : c.section === "energy"
          ? "Energy"
          : "Trainer");

    const attacks = (data?.attacks ?? []).map((a) => ({
      cost: a.cost ?? [],
      damage: a.damage ?? "",
    }));

    const effectParts: string[] = [];
    for (const ab of data?.abilities ?? []) if (ab.text) effectParts.push(ab.text);
    for (const a of data?.attacks ?? []) if (a.text) effectParts.push(a.text);
    for (const r of data?.rules ?? []) if (r) effectParts.push(r);
    const effectText = effectParts.join(" ").toLowerCase();

    const isEnergy = supertype === "Energy" || c.section === "energy";
    const isBasicEnergy =
      isEnergy &&
      (subtypes.includes("Basic") || c.name.toLowerCase().includes("basic"));
    const isSpecialEnergy = isEnergy && !isBasicEnergy;

    let energyProvides: string[] = [];
    if (isBasicEnergy) {
      const symbolMatch = c.name.match(/\{(\w)\}/);
      const wordMatch = c.name.match(/Basic (\w+) Energy/i);
      const typeName = symbolMatch
        ? (ENERGY_SYMBOL_TO_TYPE[symbolMatch[1]] ?? symbolMatch[1])
        : wordMatch
          ? wordMatch[1]
          : "Colorless";
      energyProvides = [typeName];
    }

    const hpNum = data?.hp == null ? null : Number(data.hp);

    return {
      name: c.name,
      qty: c.qty,
      supertype,
      subtypes,
      types: data?.types ?? [],
      hp: Number.isFinite(hpNum as number) ? (hpNum as number) : null,
      retreatCost: data?.retreat_cost ?? 0,
      evolvesFrom: (data as { evolves_from?: string | null } | null)?.evolves_from ?? null,
      attacks,
      effectText,
      isBasicEnergy,
      isSpecialEnergy,
      energyProvides,
    };
  });
}
