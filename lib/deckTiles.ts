import { cardImageLarge, cardImageSmall } from "@/lib/cardImages";
import { getAllCards, type CardIndexEntry } from "@/lib/cardsIndex";
import { normalizeForSearch } from "@/lib/searchNormalize";

export interface DeckTileCard {
  qty: number;
  name: string;
  number: string;
  setCode: string;
  section: "pokemon" | "trainer" | "energy";
}

export interface ResolvedDeckTile {
  key: string;
  name: string;
  copyCount: number;
  section: DeckTileCard["section"];
  entryId: string | null;
  setName: string;
  number: string;
  smallImageUrl: string;
  largeImageUrl: string;
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
  card: Pick<DeckTileCard, "name" | "number" | "setCode">,
): CardIndexEntry | null {
  const primary = byNameIndex.get(normalizeForSearch(card.name)) ?? [];
  const basicAlias = normalizeBasicEnergyName(card.name);
  const aliased = basicAlias ? byNameIndex.get(basicAlias) ?? [] : [];
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

interface Tile {
  name: string;
  copyCount: number;
  section: DeckTileCard["section"];
  fallbackSetCode: string;
  fallbackNumber: string;
  entry: CardIndexEntry | null;
}

const TRAINER_SUBTYPE_ORDER = ["Item", "Stadium", "Supporter", "Pokémon Tool"] as const;

function trainerSubtypeOf(tile: Tile): string {
  const subtypes = tile.entry?.subtypes ?? [];
  for (const s of TRAINER_SUBTYPE_ORDER) {
    if (subtypes.includes(s)) return s;
  }
  return "Other";
}

function byQtyName(tiles: Tile[]): Tile[] {
  return [...tiles].sort(
    (a, b) =>
      b.copyCount - a.copyCount || a.name.localeCompare(b.name),
  );
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

  const parentOf = new Map<Tile, Tile | null>();
  for (const t of tiles) {
    const parentName = t.entry?.evolvesFrom?.trim().toLowerCase() ?? null;
    parentOf.set(t, parentName ? byLowerName.get(parentName) ?? null : null);
  }

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

function orderTiles(tiles: Tile[]): Tile[] {
  const pokemon = tiles.filter((t) => t.section === "pokemon");
  const trainer = tiles.filter((t) => t.section === "trainer");
  const energy = tiles.filter((t) => t.section === "energy");

  return [
    ...orderPokemonByLine(pokemon),
    ...orderTrainersBySubtype(trainer),
    ...byQtyName(energy),
  ];
}

/**
 * Resolve a parsed deck list into the rendering payload used by both
 * `DeckCardGrid` (one tile per unique card with copy-count overlay) and
 * the admin-tools deck mat view (one fanned pile per unique card).
 *
 * Tiles are grouped by normalized name, sorted into Pokémon evolution
 * lines first, then trainers by subtype (Item → Stadium → Supporter →
 * Tool), then energy by qty.
 */
export function resolveDeckTiles(cards: DeckTileCard[]): ResolvedDeckTile[] {
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

  return tiles.map((t) => {
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
}
