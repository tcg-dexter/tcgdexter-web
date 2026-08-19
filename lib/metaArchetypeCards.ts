import metaDecksRaw from "@/data/meta-decks.json";
import { TOP_META_ARCHETYPES } from "@/lib/metaArchetypes";
import { metaPrimaryCard } from "@/lib/metaPrimaryCard";

interface DeckCard {
  qty: number;
  name: string;
  setCode: string;
  number: string;
  category: "pokemon" | "trainer" | "energy";
}

interface MetaDeck {
  id: string;
  cards: DeckCard[];
  variants?: { cards: DeckCard[] }[];
}

const METADECKS = metaDecksRaw as MetaDeck[];

export interface MetaArchetypeCard {
  imageUrl: string;
  types: string[];
  /** The specific Pokémon card name this archetype resolved to (e.g.
   *  "Dragapult ex" for the "Dragapult" archetype) — lets callers show a
   *  precise card name instead of falling back to the archetype's own
   *  (sometimes multi-word, sometimes compound) display name. */
  name: string;
}

let cache: Map<string, MetaArchetypeCard> | null = null;

/** Representative card (image + types) for each top-30 meta archetype,
 *  keyed by display name — same primary-card logic as /meta-archetypes. */
function build(): Map<string, MetaArchetypeCard> {
  const map = new Map<string, MetaArchetypeCard>();
  for (const arch of TOP_META_ARCHETYPES) {
    const deckData = METADECKS.find((d) => d.id === arch.id);
    const cards = deckData?.variants?.[0]?.cards ?? deckData?.cards ?? [];
    let iconList: string[] = [];
    try {
      iconList = arch.icons ? (JSON.parse(arch.icons) as string[]) : [];
    } catch {
      iconList = [];
    }
    const primary = metaPrimaryCard(cards, iconList);
    if (primary) {
      map.set(arch.name, { imageUrl: primary.imageUrl, types: primary.types, name: primary.name });
    }
  }
  return map;
}

/** Representative card for a top-30 meta archetype by exact display name,
 *  or null if the name isn't a recognized archetype (or has no resolvable
 *  primary card). */
export function metaArchetypeCard(name: string): MetaArchetypeCard | null {
  if (!cache) cache = build();
  return cache.get(name) ?? null;
}
