/**
 * Set-level logo + symbol URLs, derived from `set_id`. Mirrors the
 * approach in `lib/cardImages.ts`: pokemontcg.io is the default CDN,
 * with overrides for sets that aren't (yet) indexed there.
 *
 * Set logos are wide transparent PNGs (variable aspect ratio); set
 * symbols are small square transparent PNGs. Both default to
 * pokemontcg.io's stable per-set URLs:
 *   logo:   https://images.pokemontcg.io/{setId}/logo.png
 *   symbol: https://images.pokemontcg.io/{setId}/symbol.png
 *
 * Returns `null` for sets we know aren't on pokemontcg.io's CDN yet,
 * so consumers can fall back to a text/badge representation instead
 * of fetching an image that will 404.
 */

/**
 * Sets that the pokemontcg.io CDN doesn't carry — for these we use
 * limitlesstcg / scrydex for card images (see `lib/cardImages.ts`).
 * Logos and symbols don't have a reliable equivalent host yet, so
 * callers should fall back to the PTCGO badge.
 */
const SETS_WITHOUT_POKEMONTCG_BRAND_IMAGES = new Set<string>([
  "me2pt5",
  "me3",
  "me4",
]);

export function setLogo(setId: string): string | null {
  if (SETS_WITHOUT_POKEMONTCG_BRAND_IMAGES.has(setId)) return null;
  return `https://images.pokemontcg.io/${setId}/logo.png`;
}

export function setSymbol(setId: string): string | null {
  if (SETS_WITHOUT_POKEMONTCG_BRAND_IMAGES.has(setId)) return null;
  return `https://images.pokemontcg.io/${setId}/symbol.png`;
}
