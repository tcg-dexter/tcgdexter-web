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
 * Per-set logo/symbol overrides for sets the pokemontcg.io CDN doesn't
 * carry yet. The three Mega Evolution sets below pull card art from
 * Limitless's TPCI press-kit mirror (see `lib/cardImages.ts`) and
 * scrydex respectively; their press-kit logo files live alongside the
 * card art with the conventional `_LOGO_EN.png` suffix.
 *
 * If upstream changes a path (or pokemontcg.io eventually backfills
 * the set), update or remove the entry — `SetLogo` will silently fall
 * back to the PTCGO badge on a 404 in the meantime.
 */
const SET_BRAND_OVERRIDES: Record<string, BrandImageOverride> = {
  // Ascended Heroes (me2pt5 / ASC)
  me2pt5: {
    logo: "https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/ASC/ASC_LOGO_EN.png",
    symbol: "https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/ASC/ASC_SYMBOL_EN.png",
  },
  // Perfect Order (me3 / POR)
  me3: {
    logo: "https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/POR/POR_LOGO_EN.png",
    symbol: "https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/POR/POR_SYMBOL_EN.png",
  },
  // Chaos Rising (me4 / CRI) — scrydex hosts brand assets at the same
  // base path as the card images, using the set id as the slug.
  me4: {
    logo: "https://images.scrydex.com/pokemon/me4/logo",
    symbol: "https://images.scrydex.com/pokemon/me4/symbol",
  },
};

export function setLogo(setId: string): string | null {
  const override = SET_BRAND_OVERRIDES[setId];
  if (override) return override.logo;
  return `https://images.pokemontcg.io/${setId}/logo.png`;
}

export function setSymbol(setId: string): string | null {
  const override = SET_BRAND_OVERRIDES[setId];
  if (override) return override.symbol;
  return `https://images.pokemontcg.io/${setId}/symbol.png`;
}
