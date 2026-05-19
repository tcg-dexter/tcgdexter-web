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

export interface CollectionEntry {
  setId: string;
  number: string;
  variant: CollectionVariantKey;
  quantity: number;
}
