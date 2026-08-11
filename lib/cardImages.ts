import imageOverrides from "@/data/card-image-overrides.json";

type ImageVariant = "small" | "large";

/**
 * Exact URLs for printings whose image address can't be built from
 * (setId, number). Generated daily by
 * `dexter-ops/scripts/export_cards_standard.py` — see `load_image_overrides`
 * for how each entry is derived.
 *
 * Covers three kinds of exception the template below can't express: upstream
 * URLs that don't follow the pattern (Celebrations: Classic Collection suffixes
 * its reprints `107_A`; ex10's Unown "?" is served as `question.png`, since a
 * literal `?` would start a query string), sets pokemontcg.io routes to
 * scrydex, and the McDonald's collections it dropped entirely, which only
 * TCGplayer's CDN still serves.
 */
const CARD_IMAGE_OVERRIDES = imageOverrides as Record<
  string,
  { s?: string; l?: string; fs?: string; fl?: string }
>;

type Template = { small: string; large: string };

const PTCG: Template = {
  small: "https://images.pokemontcg.io/{setId}/{n}.png",
  large: "https://images.pokemontcg.io/{setId}/{n}_hires.png",
};

/**
 * Limitless TCG hosts the TPCI press-kit images, usually within a day of
 * reveal. Naming there is counterintuitive: `_LG` is the ~460x640 thumbnail
 * and the unsuffixed file is the ~736x1024 hires — so small→`_LG`,
 * large→unsuffixed. Card numbers are stripped of their set-letter prefix and
 * zero-padded to three: our `SWSH001` and `DP01` are both `001` there.
 */
function limitless(code: string): Template {
  return {
    small: `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/${code}/${code}_{lim}_R_EN_LG.png`,
    large: `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/${code}/${code}_{lim}_R_EN.png`,
  };
}

function scrydex(setId: string): Template {
  return {
    small: `https://images.scrydex.com/pokemon/${setId}-{n}/small`,
    large: `https://images.scrydex.com/pokemon/${setId}-{n}/large`,
  };
}

/**
 * Ordered image sources per set — first that loads wins, and `CardImage`
 * walks the list on error before giving up and drawing its placeholder.
 *
 * A chain rather than a single override because coverage is genuinely split
 * for some sets. Scarlet & Violet Black Star Promos is the clearest case:
 * pokemontcg.io serves 199 of our 226 cards, Limitless serves 217, and each
 * has cards the other lacks (only pokemontcg.io has #85; only Limitless has
 * the 19 newest). Picking either host alone would leave working images broken.
 *
 * Sets absent from this map fall back to pokemontcg.io, which is right for
 * the ~160 sets it indexes completely.
 */
const SET_IMAGE_SOURCES: Record<string, Template[]> = {
  // ── Mega Evolution era: not indexed by pokemontcg.io at all ──
  me1: [limitless("MEG")],
  me2: [limitless("PFL")],
  me2pt5: [limitless("ASC")],
  me3: [limitless("POR")],
  // Chaos Rising and Pitch Black — pokemontcg.io has the metadata but routes
  // its image URLs to scrydex (no .png suffix, no zero-padding).
  me4: [scrydex("me4")],
  me5: [scrydex("me5")],

  // ── Black Star Promos ──
  // MEP and MEE are TCGdex-sourced sets pokemontcg.io doesn't index, so
  // Limitless is the only source; it covers both completely.
  mep: [limitless("MEP")],
  mee: [limitless("MEE")],
  // SVP and HGSSP are split coverage — try both.
  svp: [PTCG, limitless("SVP")],
  hsp: [PTCG, limitless("HGSSP")],
  // pokemontcg.io covers these completely today; Limitless is only a safety
  // net for cards added to the set before pokemontcg.io catches up.
  bwp: [PTCG, limitless("BWP")],
  xyp: [PTCG, limitless("XYP")],
  smp: [PTCG, limitless("SMP")],
  swshp: [PTCG, limitless("SWSHP")],
};

/** Limitless drops the set-letter prefix and pads to 3: `SWSH001` → `001`. */
function limitlessNumber(number: string): string {
  const m = /^[A-Za-z]*(\d+)([a-zA-Z]*)$/.exec(number);
  return m ? m[1].padStart(3, "0") + m[2].toLowerCase() : number;
}

function fill(template: string, setId: string, number: string): string {
  return template
    .replace("{setId}", setId)
    .replace("{lim}", limitlessNumber(number))
    .replace("{nnn}", /^\d+$/.test(number) ? number.padStart(3, "0") : number)
    .replace("{n}", number);
}

/**
 * Every image URL worth trying for a printing, best first. Callers that can
 * retry (see `CardImage`) should walk the whole list; callers that need a
 * single URL can take the first.
 */
export function cardImageCandidates(
  setId: string,
  number: string,
  variant: ImageVariant,
): string[] {
  const sources = SET_IMAGE_SOURCES[setId] ?? [PTCG];
  const built = sources.map((t) => fill(t[variant], setId, number));
  const override = CARD_IMAGE_OVERRIDES[`${setId}-${number}`];
  if (!override) return built;

  const large = variant === "large";
  // `s`/`l` is a known-exact URL and wins over anything we construct. `fs`/`fl`
  // is a last resort (a TCGplayer product photo rather than a card scan), so it
  // trails everything the set's own CDNs offer. The constructed URLs stay in
  // the list either way — the override is a daily snapshot of what upstream
  // advertised, so if it goes stale the chain still has somewhere to fall.
  const exact = large ? override.l : override.s;
  const fallback = large ? override.fl : override.fs;
  const chain = exact ? [exact, ...built] : [...built];
  if (fallback) chain.push(fallback);
  return chain.filter((u, i) => u && chain.indexOf(u) === i);
}

export function cardImageSmall(setId: string, number: string): string {
  return cardImageCandidates(setId, number, "small")[0];
}

export function cardImageLarge(setId: string, number: string): string {
  return cardImageCandidates(setId, number, "large")[0];
}

/** Everything after the primary URL — pass straight to `CardImage`'s
 *  `fallbackSrcs`. Empty for the sets served by a single CDN. */
export function cardImageFallbacks(
  setId: string,
  number: string,
  variant: ImageVariant = "small",
): string[] {
  return cardImageCandidates(setId, number, variant).slice(1);
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
  // Only source still serving the McDonald's 2014/2015/2017/2018 collections.
  "https://tcgplayer-cdn.tcgplayer.com/product/",
] as const;

/** True when `url` is one of our trusted card-image hosts. */
export function isTrustedCardImageUrl(url: string): boolean {
  return TRUSTED_CARD_IMAGE_PREFIXES.some((prefix) => url.startsWith(prefix));
}
