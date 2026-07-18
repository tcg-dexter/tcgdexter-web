type ImageVariant = "small" | "large";

/**
 * Per-set CDN overrides. Default for every set is pokemontcg.io, which is
 * community-maintained and typically lags newly released sets by a few
 * weeks. When we have a known-good alternative source for a specific set,
 * register a template here — `{n}` is replaced with the card number,
 * `{nnn}` with the number zero-padded to 3 digits, and `{v}` with "" for
 * small or "_hires" for large.
 *
 * Limitless TCG hosts the TPCI press kit images for the latest sets,
 * usually within a day of reveal. Naming there is counterintuitive:
 * `_LG` is the ~460x640 thumbnail and the unsuffixed file is the
 * ~736x1024 hires — we map small→`_LG` and large→unsuffixed.
 */
const SET_IMAGE_OVERRIDES: Record<string, { small: string; large: string }> = {
  // Mega Evolution Generations — not indexed by pokemontcg.io
  me1: {
    small: "https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/MEG/MEG_{nnn}_R_EN_LG.png",
    large: "https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/MEG/MEG_{nnn}_R_EN.png",
  },
  // Phantom Flames — not indexed by pokemontcg.io
  me2: {
    small: "https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/PFL/PFL_{nnn}_R_EN_LG.png",
    large: "https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/PFL/PFL_{nnn}_R_EN.png",
  },
  // Ascended Heroes — not yet indexed by pokemontcg.io
  me2pt5: {
    small: "https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/ASC/ASC_{nnn}_R_EN_LG.png",
    large: "https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/ASC/ASC_{nnn}_R_EN.png",
  },
  // Perfect Order — not yet indexed by pokemontcg.io
  me3: {
    small: "https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/POR/POR_{nnn}_R_EN_LG.png",
    large: "https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/POR/POR_{nnn}_R_EN.png",
  },
  // Chaos Rising — pokemontcg.io has the metadata but routes its image URLs
  // to images.scrydex.com for this set (no .png suffix, no zero-padding).
  me4: {
    small: "https://images.scrydex.com/pokemon/me4-{n}/small",
    large: "https://images.scrydex.com/pokemon/me4-{n}/large",
  },
  // Pitch Black — same scrydex routing as Chaos Rising above.
  me5: {
    small: "https://images.scrydex.com/pokemon/me5-{n}/small",
    large: "https://images.scrydex.com/pokemon/me5-{n}/large",
  },
};

function build(setId: string, number: string, variant: ImageVariant): string {
  const override = SET_IMAGE_OVERRIDES[setId];
  const suffix = variant === "large" ? "_hires" : "";
  if (override) {
    const padded = /^\d+$/.test(number) ? number.padStart(3, "0") : number;
    return override[variant]
      .replace("{nnn}", padded)
      .replace("{n}", number)
      .replace("{v}", suffix);
  }
  return `https://images.pokemontcg.io/${setId}/${number}${suffix}.png`;
}

export function cardImageSmall(setId: string, number: string): string {
  return build(setId, number, "small");
}

export function cardImageLarge(setId: string, number: string): string {
  return build(setId, number, "large");
}

/**
 * URL-prefix allowlist for user-supplied card-image URLs (deck cover images).
 * These are the hosts our own resolvers emit — pokemontcg.io for most sets,
 * plus the per-set CDN overrides above (scrydex for Chaos Rising, Limitless
 * for the other Mega Evolution sets). Validating against this set keeps cover
 * images to images our pipeline actually serves while still covering every set
 * we support — pokemontcg.io alone wrongly rejected ME-era cards.
 */
export const TRUSTED_CARD_IMAGE_PREFIXES = [
  "https://images.pokemontcg.io/",
  "https://images.scrydex.com/",
  "https://limitlesstcg.nyc3.digitaloceanspaces.com/",
] as const;

/** True when `url` is one of our trusted card-image hosts. */
export function isTrustedCardImageUrl(url: string): boolean {
  return TRUSTED_CARD_IMAGE_PREFIXES.some((prefix) => url.startsWith(prefix));
}
