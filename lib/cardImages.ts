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
  // Chaos Rising — not yet indexed by pokemontcg.io
  me4: {
    small: "https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/CHR/CHR_{nnn}_R_EN_LG.png",
    large: "https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/CHR/CHR_{nnn}_R_EN.png",
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
