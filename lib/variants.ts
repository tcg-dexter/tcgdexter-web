/**
 * Canonical variant keys — the browser-side half of the grammar defined in
 * `dexter-ops/scripts/variant_keys.py`. Keep the two in sync.
 *
 * A "variant" is one physical printing of a card: its finish, plus any stamp,
 * foil pattern, era-specific print difference, or oversize format. These used
 * to be guessed from a card's rarity string, which was wrong for most of the
 * catalog — reverse holos didn't exist before Legendary Collection, every
 * rarity above Rare collapsed to a single "Holo", and a Play! Pokémon stamp was
 * offered on all 20k printings when only 116 actually have one. They now come
 * from TCGdex, per printing, via `card_variants` and `cards-standard.json`.
 *
 * Grammar:
 *
 *     <type>[:s=<subtype>][:f=<foil>][:t=<stamp>+<stamp>…][:z=jumbo]
 *
 * Stamps are sorted inside the key, so it never depends on the order upstream
 * listed them in. Examples:
 *
 *     normal
 *     reverse
 *     holo:f=cosmos:t=player-rewards-program   ← Play! stamp, cosmos holo
 *     normal:s=shadowless:t=1st-edition
 *     holo:z=jumbo
 */

export const VARIANT_TYPES = ["normal", "holo", "reverse", "metal", "lenticular"] as const;
export type VariantType = (typeof VARIANT_TYPES)[number];

export interface ParsedVariant {
  type: VariantType;
  subtype: string | null;
  foil: string | null;
  stamps: string[];
  size: "standard" | "jumbo";
}

const TOKEN_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEY_RE =
  /^([a-z]+)(?::s=([a-z0-9-]+))?(?::f=([a-z0-9-]+))?(?::t=([a-z0-9+-]+))?(?::z=(jumbo))?$/;

/** Parse a key, or null if it isn't valid. Round-trips with `buildVariantKey`. */
export function parseVariantKey(key: string): ParsedVariant | null {
  if (!key) return null;
  const m = KEY_RE.exec(key);
  if (!m) return null;
  const [, type, subtype, foil, stampBlob, size] = m;
  if (!(VARIANT_TYPES as readonly string[]).includes(type)) return null;
  const stamps = stampBlob ? stampBlob.split("+") : [];
  if (stamps.some((s) => !TOKEN_RE.test(s))) return null;
  // Reject non-canonical stamp ordering so one printing can't be stored under
  // two different keys.
  if (stamps.some((s, i) => i > 0 && s < stamps[i - 1])) return null;
  return {
    type: type as VariantType,
    subtype: subtype ?? null,
    foil: foil ?? null,
    stamps,
    size: size === "jumbo" ? "jumbo" : "standard",
  };
}

export function buildVariantKey(v: {
  type: VariantType;
  subtype?: string | null;
  foil?: string | null;
  stamps?: string[];
  size?: "standard" | "jumbo";
}): string {
  let key: string = v.type;
  if (v.subtype) key += `:s=${v.subtype}`;
  if (v.foil) key += `:f=${v.foil}`;
  if (v.stamps?.length) key += `:t=${[...v.stamps].sort().join("+")}`;
  if (v.size === "jumbo") key += ":z=jumbo";
  return key;
}

export function isValidVariantKey(key: string): boolean {
  return parseVariantKey(key) !== null;
}

// ── Labels ─────────────────────────────────────────────────────────────────

/**
 * Wording for the keys people actually recognise. Everything else is composed
 * from its parts by `variantLabel` — there are ~130 stamps upstream, most of
 * them player names on Worlds invite cards, and hand-writing labels for all of
 * them would rot the moment TCGdex adds one.
 */
const EXACT_LABELS: Record<string, string> = {
  normal: "Normal",
  holo: "Holo",
  reverse: "Reverse Holo",
  "holo:t=player-rewards-program": "Play! Pokémon Stamp",
  "normal:t=player-rewards-program": "Play! Pokémon Stamp (Non-Holo)",
  "holo:f=cosmos:t=player-rewards-program": "Play! Pokémon Stamp — Cosmos Holo",
  "holo:f=cosmos": "Cosmos Holo",
  "holo:t=1st-edition": "1st Edition Holo",
  "normal:t=1st-edition": "1st Edition",
  "holo:t=set-logo": "Prerelease",
  "holo:t=set-logo+staff": "Prerelease (Staff)",
  "holo:t=staff": "Staff",
  "holo:t=pokemon-center": "Pokémon Center",
};

const TYPE_LABELS: Record<VariantType, string> = {
  normal: "Normal",
  holo: "Holo",
  reverse: "Reverse Holo",
  metal: "Metal",
  lenticular: "Lenticular",
};

/** Stamps whose natural-language name isn't just the slug title-cased. */
const STAMP_LABELS: Record<string, string> = {
  "player-rewards-program": "Play! Pokémon Stamp",
  "set-logo": "Prerelease",
  "1st-edition": "1st Edition",
  "pre-release": "Prerelease",
  "pokemon-center": "Pokémon Center",
  "pokemon-center-ny": "Pokémon Center NY",
  "w-promo": "W Promo",
  "poke-ball-league": "Poké Ball League",
  "master-ball-league": "Master Ball League",
  "ultra-ball-league": "Ultra Ball League",
  "trick-or-trade": "Trick or Trade",
  "eb-games": "EB Games",
  "top-eight": "Top 8",
  "top-sixteen": "Top 16",
  "top-thirty-two": "Top 32",
  "25th-celebration": "25th Celebration",
  "30th-pokeday": "30th Pokéday",
  mcdonalds: "McDonald's",
  wotc: "WotC",
};

const FOIL_LABELS: Record<string, string> = {
  cosmos: "Cosmos",
  "cracked-ice": "Cracked Ice",
  pokeball: "Poké Ball",
  greatball: "Great Ball",
  ultraball: "Ultra Ball",
  masterball: "Master Ball",
  loveball: "Love Ball",
  friendball: "Friend Ball",
  quickball: "Quick Ball",
  duskball: "Dusk Ball",
  "team-rocket": "Team Rocket",
  "player-reward": "Player Reward",
  "professor-program": "Professor Program",
};

function titleCase(slug: string): string {
  return slug
    .split("-")
    .map((w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

function labelFor(slug: string, overrides: Record<string, string>): string {
  return overrides[slug] ?? titleCase(slug);
}

/** Human-readable name for a variant key. Falls back to the raw key if it
 *  doesn't parse, so an unexpected value is visible rather than blank. */
export function variantLabel(key: string): string {
  const exact = EXACT_LABELS[key];
  if (exact) return exact;

  const v = parseVariantKey(key);
  if (!v) return key;

  const parts: string[] = [];
  if (v.foil) parts.push(`${labelFor(v.foil, FOIL_LABELS)} ${TYPE_LABELS[v.type]}`);
  else parts.push(TYPE_LABELS[v.type]);
  if (v.subtype) parts.push(`(${labelFor(v.subtype, {})})`);
  if (v.stamps.length) {
    parts.push(`— ${v.stamps.map((s) => labelFor(s, STAMP_LABELS)).join(" + ")}`);
  }
  if (v.size === "jumbo") parts.push("(Jumbo)");
  return parts.join(" ");
}

// ── Ordering & grouping ────────────────────────────────────────────────────

const TYPE_ORDER: Record<string, number> = {
  normal: 0, holo: 1, reverse: 2, metal: 3, lenticular: 4,
};

/** True when the printing carries something beyond a plain finish — a stamp,
 *  a foil pattern, an era-specific difference, or oversize format. */
export function isSpecialPrinting(key: string): boolean {
  const v = parseVariantKey(key);
  if (!v) return true;
  return Boolean(v.subtype || v.foil || v.stamps.length) || v.size === "jumbo";
}

/** Sort comparator: plain finishes first, then decorated, then jumbo. */
export function compareVariants(a: string, b: string): number {
  const pa = parseVariantKey(a);
  const pb = parseVariantKey(b);
  const rank = (p: ParsedVariant | null) =>
    p === null ? 9 : p.size === "jumbo" ? 2 : p.subtype || p.foil || p.stamps.length ? 1 : 0;
  const ra = rank(pa);
  const rb = rank(pb);
  if (ra !== rb) return ra - rb;
  const ta = pa ? TYPE_ORDER[pa.type] ?? 9 : 9;
  const tb = pb ? TYPE_ORDER[pb.type] ?? 9 : 9;
  if (ta !== tb) return ta - tb;
  return a.localeCompare(b);
}

/**
 * Finishes to offer when we have no variant data for a printing.
 *
 * Deliberately minimal and honest: these are the three finishes that exist
 * across essentially every era, offered so the collection UI still works on a
 * card TCGdex hasn't described (168 of ~20.5k printings today, mostly older
 * promos). It is *not* a return to guessing from rarity — nothing here is
 * claimed to exist for the specific card.
 */
export const FALLBACK_VARIANTS: string[] = ["normal", "holo", "reverse"];
