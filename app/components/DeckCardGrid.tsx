import DeckCardGridClient, {
  type ResolvedTile,
} from "@/app/components/DeckCardGridClient";
import { cardImageLarge, cardImageSmall } from "@/lib/cardImages";
import { getAllCards, type CardIndexEntry } from "@/lib/cardsIndex";
import { normalizeForSearch } from "@/lib/searchNormalize";

interface AnalysisCard {
  qty: number;
  name: string;
  number: string;
  setCode: string;
  section: "pokemon" | "trainer" | "energy";
}

interface Tile {
  name: string;
  copyCount: number;
  section: AnalysisCard["section"];
  fallbackSetCode: string;
  fallbackNumber: string;
  entry: CardIndexEntry | null;
}

const ENERGY_SYMBOL_TO_TYPE: Record<string, string> = {
  R: "Fire", W: "Water", G: "Grass", L: "Lightning",
  P: "Psychic", F: "Fighting", D: "Darkness", M: "Metal",
  Y: "Fairy", N: "Dragon", C: "Colorless",
};

const BASIC_ENERGY_TYPES = new Set([
  "fire", "water", "grass", "lightning", "psychic",
  "fighting", "darkness", "metal", "fairy",
]);

/** Map a decklist energy name to its "Basic {Type} Energy" index key so we
 *  fall through to the SV-era reprints instead of the base1/BW legacy
 *  entries. Handles two decklist conventions:
 *    • Symbol form — "Basic {D} Energy" → "basic darkness energy"
 *    • Bare form   — "Fire Energy"     → "basic fire energy"
 *  Returns null for non-basic energies (e.g. "Telepathic Psychic Energy",
 *  "Boomerang Energy"). */
function normalizeBasicEnergyName(name: string): string | null {
  const symbolMatch = name.match(/^Basic\s+\{([A-Z])\}\s+Energy$/i);
  if (symbolMatch) {
    const type = ENERGY_SYMBOL_TO_TYPE[symbolMatch[1].toUpperCase()];
    return type ? `basic ${type.toLowerCase()} energy` : null;
  }
  const bareMatch = name.match(/^([A-Za-z]+)\s+Energy$/);
  if (bareMatch) {
    const type = bareMatch[1].toLowerCase();
    if (BASIC_ENERGY_TYPES.has(type)) return `basic ${type} energy`;
  }
  return null;
}

const SECRET_RARITIES = new Set([
  "Hyper Rare",
  "Rare Secret",
  "Special Illustration Rare",
  "Illustration Rare",
  "Rare Rainbow",
  "Rare Holo Star",
]);

/** When no exact (set, number) match exists, pick the most recent canonical
 *  printing by set release date. Skips secret/hyper/illustration rares so
 *  basic energies fall back to a plain reprint, not a $60 special art. */
function pickMostRecentCanonical(
  candidates: CardIndexEntry[],
): CardIndexEntry | null {
  const canonical = candidates.filter(
    (c) => !c.rarity || !SECRET_RARITIES.has(c.rarity),
  );
  const pool = canonical.length ? canonical : candidates;
  return [...pool].sort((a, b) => {
    const dateDiff = b.setReleaseDate.localeCompare(a.setReleaseDate);
    if (dateDiff !== 0) return dateDiff;
    return (a.numberNumeric ?? 9999) - (b.numberNumeric ?? 9999);
  })[0] ?? null;
}

function resolveEntry(
  byNameIndex: Map<string, CardIndexEntry[]>,
  card: Pick<AnalysisCard, "name" | "number" | "setCode">,
): CardIndexEntry | null {
  // Index keys are normalized via normalizeForSearch (strips diacritics);
  // the lookup must do the same or names like "Poké Pad" and "Pokégear 3.0"
  // miss the index entirely.
  const primary = byNameIndex.get(normalizeForSearch(card.name)) ?? [];
  const basicAlias = normalizeBasicEnergyName(card.name);
  const aliased = basicAlias ? byNameIndex.get(basicAlias) ?? [] : [];
  // Union both name buckets so "Fire Energy" decklists can resolve to a
  // "Basic Fire Energy" reprint when no legacy printing matches the
  // requested set/number (e.g. MEE, which we don't yet carry in the DB).
  const lookupName = aliased.length ? [...primary, ...aliased] : primary;
  if (!lookupName.length) return null;
  return (
    lookupName.find(
      (c) => c.ptcgoCode === card.setCode && c.number === card.number,
    ) ??
    lookupName.find((c) => c.number === card.number) ??
    pickMostRecentCanonical(lookupName)
  );
}

/**
 * Order a deck's tiles for the grid:
 *   • Pokémon first, grouped into evolution lines (Basic → Stage 1 → … → Mega).
 *     A tile's evolvesFrom is matched (case-insensitive) against other Pokémon
 *     names in the deck. Chains that bottom out at a Pokémon not in the deck
 *     still group together — that Pokémon's lowest-in-deck stage acts as the
 *     root. Lines are ordered by total copy count desc (most-played line
 *     first); within a line, by evolution depth asc, then qty desc, name asc.
 *   • Trainers next, then Energy. Both sorted by qty desc, name asc — no
 *     evolution grouping applies.
 *
 * Safe when `evolvesFrom` is null everywhere (pre-backfill): every Pokémon
 * becomes its own line, so the result degrades to the previous qty/name
 * ordering within section.
 */
function orderTiles(tiles: Tile[]): Tile[] {
  const pokemon = tiles.filter((t) => t.section === "pokemon");
  const trainer = tiles.filter((t) => t.section === "trainer");
  const energy = tiles.filter((t) => t.section === "energy");

  return [...orderPokemonByLine(pokemon), ...orderTrainersBySubtype(trainer), ...byQtyName(energy)];
}

function byQtyName(tiles: Tile[]): Tile[] {
  return [...tiles].sort(
    (a, b) =>
      b.copyCount - a.copyCount || a.name.localeCompare(b.name),
  );
}

/**
 * Group trainers by subtype to match TCG Live's deck view:
 * Items → Stadiums → Supporters → Tools. Within each group, sort A–Z by
 * name (no special treatment for ACE SPEC). Anything we can't classify
 * (unresolved entries, or subtypes we don't recognize) lands in a
 * trailing "other" bucket so nothing silently disappears from the grid.
 */
const TRAINER_SUBTYPE_ORDER = ["Item", "Stadium", "Supporter", "Pokémon Tool"] as const;

function trainerSubtypeOf(tile: Tile): string {
  const subtypes = tile.entry?.subtypes ?? [];
  for (const s of TRAINER_SUBTYPE_ORDER) {
    if (subtypes.includes(s)) return s;
  }
  return "Other";
}

function byName(tiles: Tile[]): Tile[] {
  return [...tiles].sort((a, b) => a.name.localeCompare(b.name));
}

function orderTrainersBySubtype(tiles: Tile[]): Tile[] {
  const buckets = new Map<string, Tile[]>();
  for (const t of tiles) {
    const key = trainerSubtypeOf(t);
    const arr = buckets.get(key) ?? [];
    arr.push(t);
    buckets.set(key, arr);
  }
  const ordered: Tile[] = [];
  for (const subtype of TRAINER_SUBTYPE_ORDER) {
    const bucket = buckets.get(subtype);
    if (bucket) ordered.push(...byName(bucket));
  }
  const other = buckets.get("Other");
  if (other) ordered.push(...byName(other));
  return ordered;
}

function orderPokemonByLine(tiles: Tile[]): Tile[] {
  if (tiles.length <= 1) return tiles;

  const byLowerName = new Map<string, Tile>();
  for (const t of tiles) byLowerName.set(t.name.toLowerCase(), t);

  // Resolve each tile's in-deck parent (or null if its evolvesFrom isn't in
  // the deck, or it's a Basic with no evolvesFrom).
  const parentOf = new Map<Tile, Tile | null>();
  for (const t of tiles) {
    const parentName = t.entry?.evolvesFrom?.trim().toLowerCase() ?? null;
    parentOf.set(t, parentName ? byLowerName.get(parentName) ?? null : null);
  }

  // Walk to the root for each tile (defensive against cycles).
  function rootOf(tile: Tile): Tile {
    const seen = new Set<Tile>();
    let cur = tile;
    while (parentOf.get(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = parentOf.get(cur)!;
    }
    return cur;
  }

  function depthOf(tile: Tile): number {
    const seen = new Set<Tile>();
    let d = 0;
    let cur = tile;
    while (parentOf.get(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = parentOf.get(cur)!;
      d++;
    }
    return d;
  }

  const linesByRoot = new Map<Tile, Tile[]>();
  for (const t of tiles) {
    const root = rootOf(t);
    const arr = linesByRoot.get(root) ?? [];
    arr.push(t);
    linesByRoot.set(root, arr);
  }

  const lines = Array.from(linesByRoot.entries()).map(([root, members]) => ({
    root,
    members,
    totalQty: members.reduce((s, t) => s + t.copyCount, 0),
  }));
  lines.sort(
    (a, b) =>
      b.totalQty - a.totalQty || a.root.name.localeCompare(b.root.name),
  );
  for (const line of lines) {
    line.members.sort(
      (a, b) =>
        depthOf(a) - depthOf(b) ||
        b.copyCount - a.copyCount ||
        a.name.localeCompare(b.name),
    );
  }

  return lines.flatMap((l) => l.members);
}

/**
 * Renders a deck's contents as a responsive grid of card images, one tile
 * per unique card name. Footer overlay shows set/number plus copy count.
 *
 * Tiles with no resolvable image fall back to `CardImage`'s built-in
 * "no image" placeholder, keeping the footer count visible. Multiple
 * printings of the same name are folded into a single tile with the
 * summed copy count and the first printing's image.
 *
 * Mirrors the visual treatment of `app/cards` (`GridTile` + the gradient
 * `CardFooterOverlay`) so deck profiles feel of a piece with the catalog.
 */
export default function DeckCardGrid({ cards }: { cards: AnalysisCard[] }) {
  // Group by normalized name; sum copy counts across printings.
  const grouped = new Map<string, Tile>();
  for (const c of cards) {
    const key = c.name.trim().toLowerCase();
    const existing = grouped.get(key);
    if (existing) {
      existing.copyCount += c.qty;
    } else {
      grouped.set(key, {
        name: c.name,
        copyCount: c.qty,
        section: c.section,
        fallbackSetCode: c.setCode,
        fallbackNumber: c.number,
        entry: null,
      });
    }
  }

  // Resolve each tile to its CardIndexEntry for image + set metadata.
  // Build a name→entries map once so we don't scan the full index per tile.
  const byNameIndex = new Map<string, CardIndexEntry[]>();
  for (const c of getAllCards()) {
    const arr = byNameIndex.get(c.nameLower);
    if (arr) arr.push(c);
    else byNameIndex.set(c.nameLower, [c]);
  }
  const allTiles = Array.from(grouped.values()).map((tile) => {
    tile.entry = resolveEntry(byNameIndex, {
      name: tile.name,
      number: tile.fallbackNumber,
      setCode: tile.fallbackSetCode,
    });
    return tile;
  });

  const tiles = orderTiles(allTiles);

  if (tiles.length === 0) return null;

  // Serialize the resolved tiles for the client component. Picking only the
  // fields the UI needs keeps the payload small — the full CardIndexEntry
  // has ~20 properties we don't render.
  const resolved: ResolvedTile[] = tiles.map((t) => {
    const entry = t.entry;
    const setId = entry?.setId ?? "";
    const number = entry?.number ?? t.fallbackNumber;
    const setName = entry?.setName ?? "";
    return {
      key: `${t.section}:${t.name.toLowerCase()}`,
      name: t.name,
      copyCount: t.copyCount,
      section: t.section,
      entryId: entry?.id ?? null,
      setName,
      number,
      smallImageUrl: setId ? cardImageSmall(setId, number) : "",
      largeImageUrl: setId ? cardImageLarge(setId, number) : "",
    };
  });

  return <DeckCardGridClient tiles={resolved} />;
}
