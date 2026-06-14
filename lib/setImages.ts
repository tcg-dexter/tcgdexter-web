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
 * Returns `null` for sets that have neither pokemontcg.io coverage nor
 * a known override, so consumers can fall back to a text/badge
 * representation instead of fetching an image that will 404.
 */

interface BrandImageOverride {
  logo: string | null;
  symbol: string | null;
}

/**
 * Sets that share the canonical "Black Star Promo" wordmark instead of
 * a per-series logo. Every entry in this set maps to the same image
 * so the data view doesn't need a one-off URL per generation.
 */
const BLACK_STAR_PROMO_SETS = new Set<string>([
  "basep",  // Wizards Black Star Promos
  "np",     // Nintendo Black Star Promos
  "dpp",    // DP Black Star Promos
  "hsp",    // HGSS Black Star Promos
  "bwp",    // BW Black Star Promos
  "xyp",    // XY Black Star Promos
  "smp",    // SM Black Star Promos
  "swshp",  // SWSH Black Star Promos
  "svp",    // Scarlet & Violet Black Star Promos
  "mep",    // Mega Evolution Black Star Promos
]);

const BLACK_STAR_PROMO_LOGO = "/sets/black-star-promo.webp";

/**
 * Per-set logo/symbol overrides for sets the pokemontcg.io CDN doesn't
 * carry yet. Files live under `public/sets/` so we control caching and
 * uptime — no reliance on upstream CDNs for these one-offs.
 */
const SET_BRAND_OVERRIDES: Record<string, BrandImageOverride> = {
  // Ascended Heroes (me2pt5 / ASC)
  me2pt5: { logo: "/sets/me2pt5.webp", symbol: null },
  // Perfect Order (me3 / POR)
  me3: { logo: "/sets/me3.webp", symbol: null },
  // Chaos Rising (me4 / CRI)
  me4: { logo: "/sets/me4.webp", symbol: null },
};

export function setLogo(setId: string): string | null {
  if (BLACK_STAR_PROMO_SETS.has(setId)) return BLACK_STAR_PROMO_LOGO;
  const override = SET_BRAND_OVERRIDES[setId];
  if (override) return override.logo;
  return `https://images.pokemontcg.io/${setId}/logo.png`;
}

export function setSymbol(setId: string): string | null {
  if (BLACK_STAR_PROMO_SETS.has(setId)) return BLACK_STAR_PROMO_LOGO;
  const override = SET_BRAND_OVERRIDES[setId];
  if (override) return override.symbol;
  return `https://images.pokemontcg.io/${setId}/symbol.png`;
}
