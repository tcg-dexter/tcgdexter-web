export const COLLECTION_VARIANTS = [
  { key: "normal", label: "Normal" },
  { key: "holo", label: "Holo" },
  { key: "reverse_holo", label: "Reverse Holo" },
  { key: "prize_pack", label: "Play! Pokémon Stamp" },
] as const;

export type CollectionVariantKey = (typeof COLLECTION_VARIANTS)[number]["key"];

const VALID_KEYS = new Set<string>(COLLECTION_VARIANTS.map((v) => v.key));

export function isValidVariant(v: string): v is CollectionVariantKey {
  return VALID_KEYS.has(v);
}

/**
 * Variants offered in the "add" menu for a given printing's rarity.
 * Removal still surfaces any owned variant — this filter only narrows
 * what a user can newly add, so the menu doesn't list finishes that
 * effectively never exist for that rarity.
 *
 * - Common / Uncommon: printed Normal + Reverse Holo (no Holo finish).
 * - Rare: printed Holo + Reverse Holo (no Normal finish).
 * - All other rarities (Rare Holo, Ultras, IRs, SIRs, Hypers, Promos,
 *   etc.): only the single Holo finish exists.
 *
 * The Play! Pokémon Stamp is offered on every printing — it's a stamp
 * variant that can be applied to any rarity at events.
 */
export function allowedAddVariants(rarity: string | null): CollectionVariantKey[] {
  const r = (rarity ?? "").trim().toLowerCase();
  if (r === "common" || r === "uncommon") {
    return ["normal", "reverse_holo", "prize_pack"];
  }
  if (r === "rare") {
    return ["holo", "reverse_holo", "prize_pack"];
  }
  return ["holo", "prize_pack"];
}

export interface CollectionEntry {
  setId: string;
  number: string;
  variant: CollectionVariantKey;
  quantity: number;
}
