import cardData from "@/data/cards-standard.json";
import { cardImageSmall } from "@/lib/cardImages";
import { basicEnergyAliasKeys } from "@/lib/basicEnergyAlias";
import { allowedAddVariants } from "@/lib/inventory";

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
  rarity?: string | null;
  regulation_mark?: string | null;
  evolves_from?: string | null;
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

/** Standard-format regulation marks, oldest to newest. Higher rank = more
 *  recently printed. Cards without a regulation mark (pre-D, older sets)
 *  rank below all of them. */
const REGULATION_RANK: Record<string, number> = {
  D: 1, E: 2, F: 3, G: 4, H: 5, I: 6, J: 7,
};

/** Highest regulation-mark rank across all printings of `name`. Used to
 *  score competing forward-evolution candidates when escalating from a
 *  lower-stage attacker to the line's headline Pokémon. */
function maxRegRankForName(name: string): number {
  const entries = CARD_DB[name] ?? CARD_DB_LOWER.get(name.toLowerCase()) ?? [];
  let max = 0;
  for (const e of entries) {
    const r = REGULATION_RANK[e.regulation_mark ?? ""] ?? 0;
    if (r > max) max = r;
  }
  return max;
}

/** Real evolution-stage subtypes. Used to filter out legacy power-up
 *  mechanic cards (Level-Up, BREAK, LEGEND, …) that list themselves as
 *  "evolving from" their base form in the DB but aren't real forward
 *  evolutions — Raichu LV.X is a Diamond/Pearl power-up, not a Stage 2,
 *  and treating it as one walks the chain past where actual decks stop. */
const REAL_STAGE_SUBTYPES = new Set(["Basic", "Stage 1", "Stage 2"]);

function hasRealStage(entries: CardEntry[]): boolean {
  for (const e of entries) {
    for (const s of e.subtypes ?? []) {
      if (REAL_STAGE_SUBTYPES.has(s)) return true;
    }
  }
  return false;
}

/** Forward-evolution index built once at module load: lowercased parent
 *  name → list of card names that evolve from it. Backs
 *  `highestEvolutionForName` without scanning the whole DB per call.
 *  Mechanic-only evolvers (LV.X / BREAK / etc.) are excluded — see
 *  `hasRealStage`. */
const EVOLVES_INTO_INDEX: Map<string, string[]> = (() => {
  const out = new Map<string, string[]>();
  for (const [evolverName, entries] of Object.entries(CARD_DB)) {
    if (!hasRealStage(entries)) continue;
    const parents = new Set<string>();
    for (const e of entries) {
      if (e.evolves_from) parents.add(e.evolves_from.toLowerCase());
    }
    for (const parent of Array.from(parents)) {
      const arr = out.get(parent);
      if (arr) arr.push(evolverName);
      else out.set(parent, [evolverName]);
    }
  }
  return out;
})();

/** Walk `evolves_from` forward from `name` until we hit a Pokémon that no
 *  other card evolves from, then return that name. When a parent has
 *  multiple forward evolutions (e.g. Kadabra → Alakazam *and* Alakazam ex),
 *  prefer the one with the most recently regulation-marked print — the
 *  modern Standard variant is almost always what an opponent's deck is
 *  built around. Falls back to the input name when no chain exists.
 *
 *  This lets battle-log inference (which lands on whatever attacker dealt
 *  the most damage) bubble up to the headline mon for the line — e.g. an
 *  opponent's Kadabra resolves to Alakazam ex even though Kadabra is the
 *  card that did the attacking. */
export function highestEvolutionForName(name: string): string {
  const visited = new Set<string>([name.toLowerCase()]);
  let current = name;
  while (true) {
    const evolvers = EVOLVES_INTO_INDEX.get(current.toLowerCase()) ?? [];
    if (!evolvers.length) break;
    const next = [...evolvers]
      .map((n) => ({ name: n, rank: maxRegRankForName(n) }))
      .sort((a, b) => b.rank - a.rank)[0].name;
    if (visited.has(next.toLowerCase())) break;
    visited.add(next.toLowerCase());
    current = next;
  }
  return current;
}

/** Derive a card image URL from a Pokémon name alone (no set/number).
 *  Used when only the attacker name is known from a battle log. Escalates
 *  to the line's highest evolution via `highestEvolutionForName`, then
 *  picks the most recently regulation-marked print of that name — so a
 *  Kadabra attacker shows the modern Alakazam ex (sv3pt5 MEW) rather
 *  than 1999 Base Set Kadabra. Returns null on no match. */
export function cardImageUrlForName(name: string): string | null {
  return mostRecentCardForName(highestEvolutionForName(name))?.imageUrl ?? null;
}

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

/** Same as `cardImageUrlForName` but supertype-agnostic — works for
 *  Trainer / Energy / Pokémon names alike. Picks the most recently
 *  regulation-marked print and routes through `cardImageSmall` so per-set
 *  CDN overrides are honored. Returns null when the name doesn't exist
 *  in the catalog at all. */
export function cardImageUrlForAnyName(name: string): string | null {
  const entries = (
    CARD_DB[name] ?? CARD_DB_LOWER.get(name.toLowerCase()) ?? []
  ).filter((e) => e.set_id);
  if (!entries.length) return null;
  const best = entries.reduce((a, b) =>
    (REGULATION_RANK[b.regulation_mark ?? ""] ?? 0) >
    (REGULATION_RANK[a.regulation_mark ?? ""] ?? 0)
      ? b
      : a,
  );
  return cardImageSmall(best.set_id, best.number);
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
 *  comes from a battle log (no set/number known). Escalates through the
 *  evolution chain first so we type-color by the headline mon of the line
 *  (e.g. an Eevee attacker resolves to whichever evolver is currently
 *  Standard, picking up its type). Falls back to any print of the
 *  escalated name that carries a non-empty types array. */
export function cardTypesForName(name: string): string[] {
  const escalated = highestEvolutionForName(name);
  const recent = mostRecentCardForName(escalated);
  if (recent?.types?.length) return recent.types;
  const entries = CARD_DB[escalated] ?? CARD_DB_LOWER.get(escalated.toLowerCase()) ?? [];
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

/** Every distinct (set_id, number) printing of a card name in the bundled
 *  standard DB. Used by the collection-ownership module to count a card as
 *  owned when the user has *any* printing of it, not just the deck's exact
 *  set/number. */
export function cardPrintingsForName(
  name: string,
): { setId: string; number: string }[] {
  const entries = CARD_DB[name] ?? CARD_DB_LOWER.get(name.toLowerCase()) ?? [];
  const out: { setId: string; number: string }[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (!e.set_id) continue;
    const key = `${e.set_id}|${e.number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ setId: e.set_id, number: e.number });
  }
  return out;
}

/** Resolve a deck-list card to the catalog "add" target for its specific
 *  printing: the (setId, number) the deck uses plus a sensible default
 *  variant for that rarity (the first finish the catalog's add menu offers).
 *  Returns null when the printing can't be resolved in the standard DB. */
export interface DeckAddTarget {
  setId: string;
  number: string;
  variant: string;
}
export function deckCardAddTarget(
  card: Pick<AnalysisCard, "name" | "number" | "setCode">,
): DeckAddTarget | null {
  const entry = resolveEntry(card);
  if (!entry?.set_id) return null;
  const variant = allowedAddVariants(entry.rarity ?? null)[0] ?? "normal";
  return { setId: entry.set_id, number: entry.number, variant };
}

/** Every Basic-stage Pokémon line in a deck list, each carrying its
 *  deck-list quantity and small card-art URL for its resolved printing
 *  (null when the printing can't be resolved). Powers the mulligan-risk
 *  module's "Draw 7" hand simulator. */
export interface DeckBasicPokemon {
  name: string;
  qty: number;
  imageUrl: string | null;
}
export function basicPokemonCards(
  cards: Pick<AnalysisCard, "name" | "number" | "setCode" | "qty" | "section">[],
): DeckBasicPokemon[] {
  const out: DeckBasicPokemon[] = [];
  for (const c of cards) {
    if (c.section !== "pokemon") continue;
    const entry = resolveEntry(c);
    if (!entry?.subtypes.includes("Basic")) continue;
    const imageUrl = entry.set_id ? cardImageSmall(entry.set_id, entry.number) : null;
    out.push({ name: c.name, qty: c.qty, imageUrl });
  }
  return out;
}

/** True for a basic Energy card. Basic energy is excluded from ownership math
 *  since it's freely obtainable. Reuses the canonical basicEnergyAliasKeys
 *  parser so every decklist form is caught — spelled-out ("Grass Energy",
 *  "Basic Fire Energy") *and* the TCG Live symbol form ("Basic {L} Energy").
 *  Special energies (Double Turbo, Jet, Reversal, …) never match. */
export function isBasicEnergyCard(
  card: Pick<AnalysisCard, "name">,
): boolean {
  return basicEnergyAliasKeys(card.name) !== null;
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
