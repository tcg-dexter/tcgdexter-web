import { FALLBACK_VARIANTS, isValidVariantKey, variantLabel } from "@/lib/variants";

/**
 * A collection variant is a canonical variant key — see `lib/variants.ts`.
 * It used to be one of four hardcoded strings; it's now the full printing
 * grammar, so exotic finishes (cosmos holo, prerelease staff stamps, 1st
 * Edition shadowless) are first-class rather than something bulk imports
 * smuggled in as free text.
 */
export type CollectionVariantKey = string;

/** Valid iff it parses as a canonical variant key. This replaces membership in
 *  a fixed four-item list, so the API accepts any real printing while still
 *  rejecting malformed input. */
export function isValidVariant(v: string): v is CollectionVariantKey {
  return isValidVariantKey(v);
}

/**
 * Variants offered in the "add" menu for a printing.
 *
 * `variants` is the exact set of printings the card exists in, sourced from
 * TCGdex (see `lib/variants.ts`). When it's missing — a card upstream hasn't
 * described yet — we fall back to the three finishes common to every era
 * rather than showing an empty menu.
 *
 * Removal still surfaces any owned variant, so a finish someone already has
 * recorded stays removable even if it isn't offered here.
 */
export function allowedAddVariants(variants: string[] | undefined | null): CollectionVariantKey[] {
  return variants?.length ? variants : FALLBACK_VARIANTS;
}

/** Display name for a variant key, e.g. `holo:f=cosmos:t=player-rewards-program`
 *  → "Play! Pokémon Stamp — Cosmos Holo". */
export function variantDisplayLabel(key: string): string {
  return variantLabel(key);
}

export interface CollectionEntry {
  setId: string;
  number: string;
  variant: CollectionVariantKey;
  quantity: number;
}
