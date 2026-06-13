import cardData from "@/data/cards-standard.json";
import { cardImageSmall } from "@/lib/cardImages";

interface AnalysisCard {
  qty: number;
  name: string;
  number: string;
  setCode: string;
  section: "pokemon" | "trainer" | "energy";
}

interface CardEntry {
  set_id: string;
  ptcgo_code?: string;
  number: string;
  subtypes: string[];
  types?: string[];
  supertype?: string;
  regulation_mark?: string | null;
}

const CARD_DB = cardData as unknown as Record<string, CardEntry[]>;
const CARD_DB_LOWER = new Map(
  Object.entries(CARD_DB).map(([k, v]) => [k.toLowerCase(), v as CardEntry[]])
);

const SUBTYPE_RANK: Record<string, number> = {
  "Stage 2": 6,
  VMAX: 5,
  VSTAR: 5,
  ex: 4,
  EX: 4,
  GX: 4,
  "TAG TEAM": 4,
  V: 3,
  "Stage 1": 2,
  Basic: 1,
};

function stageRank(subtypes: string[]): number {
  return subtypes.reduce((max, s) => Math.max(max, SUBTYPE_RANK[s] ?? 0), 0);
}

function resolveEntry(card: Pick<AnalysisCard, "name" | "number" | "setCode">):
  | CardEntry
  | null {
  const entries =
    CARD_DB[card.name] ??
    CARD_DB_LOWER.get(card.name.toLowerCase()) ??
    [];
  return (
    entries.find((e) => e.ptcgo_code === card.setCode && e.number === card.number) ??
    entries.find((e) => e.number === card.number) ??
    entries[0] ??
    null
  );
}

/** Strict resolver — only returns an entry when set+number both match. Used
 *  for image URL lookups where a loose fallback would produce a wrong-card
 *  image (e.g. "Psychic Energy MEE 5" matching base1 Blastoise via number=5). */
function resolveEntryExact(
  card: Pick<AnalysisCard, "name" | "number" | "setCode">,
): CardEntry | null {
  const entries =
    CARD_DB[card.name] ??
    CARD_DB_LOWER.get(card.name.toLowerCase()) ??
    [];
  return (
    entries.find((e) => e.ptcgo_code === card.setCode && e.number === card.number) ??
    null
  );
}

/**
 * Resolve a single deck-list card to its image URL. Returns null when no
 * exact set+number match exists in the local DB — callers should treat
 * null as "no image available" and skip the card. We deliberately do NOT
 * fall back to a loose number-only or first-entry match: pokemontcg.io
 * serves a card-back PNG body on 404, so a wrong-set URL renders as a
 * card back rather than failing visibly. Routes through cardImageSmall
 * so per-set CDN overrides (ME-era sets etc.) are honored.
 */
export function cardImageUrlFor(
  card: Pick<AnalysisCard, "name" | "number" | "setCode">,
): string | null {
  const match = resolveEntryExact(card);
  if (!match?.set_id) return null;
  return cardImageSmall(match.set_id, card.number);
}

/** Derive a card image URL from a Pokémon name alone (no set/number).
 *  Used when only the attacker name is known from a battle log. Picks the
 *  first DB entry for that name — may not be the most recent printing, but
 *  is acceptable for illustrative display. Returns null on no match. */
export function cardImageUrlForName(name: string): string | null {
  const entries = CARD_DB[name] ?? CARD_DB_LOWER.get(name.toLowerCase()) ?? [];
  const entry = entries.find((e) => e.set_id) ?? null;
  if (!entry) return null;
  return cardImageSmall(entry.set_id, entry.number);
}

/** Standard-format regulation marks, oldest to newest. Higher rank = more
 *  recently printed. Cards without a regulation mark (pre-D, older sets)
 *  rank below all of them. */
const REGULATION_RANK: Record<string, number> = {
  D: 1, E: 2, F: 3, G: 4, H: 5, I: 6, J: 7,
};

/** All known Pokémon card names, longest-first so a substring search below
 *  prefers more specific forms (e.g. "Charizard ex" over "Charizard"). */
const POKEMON_NAMES = Object.entries(CARD_DB)
  .filter(([, entries]) => entries.some((e) => e.supertype === "Pokémon"))
  .map(([name]) => name)
  .sort((a, b) => b.length - a.length);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Find the first (longest-matching) known Pokémon name that appears as a
 *  whole word/phrase in free text — e.g. pulling "Charizard ex" out of a
 *  manually-typed "Charizard ex / Pidgeot ex" opponent archetype. Returns
 *  null when no known Pokémon name is present. */
export function findPokemonNameInText(text: string): string | null {
  for (const name of POKEMON_NAMES) {
    const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, "i");
    if (re.test(text)) return name;
  }
  return null;
}

/** Resolve a Pokémon name to its most recently printed card — the entry
 *  with the highest regulation mark — for image + type display when only a
 *  name is known (no set/number). Returns null on no match. */
export function mostRecentCardForName(name: string): { imageUrl: string; types: string[] } | null {
  const entries = (CARD_DB[name] ?? CARD_DB_LOWER.get(name.toLowerCase()) ?? []).filter(
    (e) => e.supertype === "Pokémon" && e.set_id,
  );
  if (!entries.length) return null;
  const best = entries.reduce((a, b) =>
    (REGULATION_RANK[b.regulation_mark ?? ""] ?? 0) > (REGULATION_RANK[a.regulation_mark ?? ""] ?? 0) ? b : a,
  );
  return { imageUrl: cardImageSmall(best.set_id, best.number), types: best.types ?? [] };
}

/**
 * Given a saved deck's analysis.cards list, returns the pokemontcg.io image
 * URL for the most prominent Pokémon: highest stage first, then highest copy
 * count. Returns null when the list is empty or no set_id can be resolved.
 */
export function primaryCardImageUrl(cards: AnalysisCard[]): string | null {
  const best = primaryPokemonCard(cards);
  if (!best?.set_id) return null;
  return `https://images.pokemontcg.io/${best.set_id}/${best.card.number}.png`;
}

interface PrimaryPokemonCard {
  card: AnalysisCard;
  set_id: string | null;
  types: string[];
}

/** Same selection logic as primaryCardImageUrl, but exposes the resolved
 *  entry so callers can also derive the card's types (used for the deck
 *  collection avatar's background color). */
export function primaryPokemonCard(cards: AnalysisCard[]): PrimaryPokemonCard | null {
  const pokemon = cards.filter((c) => c.section === "pokemon");
  if (!pokemon.length) return null;

  const annotated = pokemon.map((card) => {
    const match = resolveEntry(card);
    return {
      card,
      set_id: match?.set_id ?? null,
      types: match?.types ?? [],
      rank: match ? stageRank(match.subtypes) : 0,
    };
  });

  annotated.sort((a, b) => b.rank - a.rank || b.card.qty - a.card.qty);
  const best = annotated[0];
  if (!best) return null;
  return { card: best.card, set_id: best.set_id, types: best.types };
}

/** Resolve types for a specific card (used when the cover is an explicit
 *  user override; the avatar should follow the cover, not the auto-pick). */
export function cardTypesFor(
  card: Pick<AnalysisCard, "name" | "number" | "setCode">,
): string[] {
  return resolveEntry(card)?.types ?? [];
}

/** Resolve types for a Pokémon by name alone. Used when the card identity
 *  comes from a battle log (no set/number known). Picks the first DB entry
 *  that has a types[] array. */
export function cardTypesForName(name: string): string[] {
  const entries = CARD_DB[name] ?? CARD_DB_LOWER.get(name.toLowerCase()) ?? [];
  return entries.find((e) => e.types?.length)?.types ?? [];
}

/** Resolve types for a card identified by the pokemontcg.io set_id +
 *  number (not ptcgo_code). Used by surfaces like Trainer Spotlight that
 *  store the canonical set_id rather than the deck-list ptcgo_code. Falls
 *  back to any entry sharing the name, then to []. */
export function cardTypesForSetIdNumber(
  setId: string,
  number: string,
  name: string,
): string[] {
  const entries = CARD_DB[name] ?? CARD_DB_LOWER.get(name.toLowerCase()) ?? [];
  const exact = entries.find((e) => e.set_id === setId && e.number === number);
  if (exact?.types?.length) return exact.types;
  return entries.find((e) => e.types?.length)?.types ?? [];
}

export interface DeckAvatarInfo {
  /** The card name used to derive the sprite slug. */
  name: string;
  /** Energy types of the resolved card (drives the avatar's background). */
  types: string[];
}

/** Pick the Pokémon card that should drive the deck's avatar. When the
 *  user has explicitly set a cover image to a Pokémon card, the avatar
 *  follows that card; otherwise it falls back to the auto-picked primary. */
export function deckAvatarInfo(
  cards: AnalysisCard[],
  coverUrl: string | null,
): DeckAvatarInfo | null {
  if (coverUrl) {
    for (const card of cards) {
      if (card.section !== "pokemon") continue;
      if (cardImageUrlFor(card) === coverUrl) {
        return { name: card.name, types: cardTypesFor(card) };
      }
    }
  }
  const primary = primaryPokemonCard(cards);
  if (!primary) return null;
  return { name: primary.card.name, types: primary.types };
}

/** Build a Limitless sprite slug from a Pokémon card name. Strips common
 *  rarity/form suffixes (ex, V, VSTAR, VMAX, GX, Mega…) and joins the
 *  remaining tokens with hyphens — mirrors the slugs the Limitless scraper
 *  emits for meta archetypes (e.g. "Raging Bolt ex" → "raging-bolt"). */
const SUFFIX_TOKENS = new Set([
  "ex", "v", "vmax", "vstar", "gx", "mega", "tag", "team",
]);
export function pokemonSlug(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !SUFFIX_TOKENS.has(t));
  // Drop a leading "trainer's pokemon" qualifier (e.g. "N's Zoroark" → "zoroark";
  // we already stripped the apostrophe so "ns" sits as a 2-char prefix token).
  while (cleaned[0] && cleaned[0].length <= 2) cleaned.shift();
  return cleaned.join("-");
}
