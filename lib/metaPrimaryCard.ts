import cardData from "@/data/cards-standard.json";
import { cardImageSmall } from "@/lib/cardImages";

interface CardEntry {
  set_id: string;
  ptcgo_code?: string;
  number: string;
  supertype: string;
  subtypes: string[];
  types?: string[];
  hp: string | number | null;
}

const CARD_DB = cardData as unknown as Record<string, CardEntry[]>;
const CARD_DB_LOWER = new Map(
  Object.entries(CARD_DB).map(([k, v]) => [k.toLowerCase(), v as CardEntry[]])
);

interface DeckCard {
  qty: number;
  name: string;
  setCode: string;
  number: string;
  category: "pokemon" | "trainer" | "energy";
}

export interface MetaPrimaryCard {
  imageUrl: string;
  types: string[];
  name: string;
}

function resolve(card: Pick<DeckCard, "name" | "number" | "setCode">): CardEntry | null {
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

function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Pick the "face" Pokémon card for a meta-deck preview. We prefer the
 * card whose name matches an archetype icon slug (e.g. for the
 * "Dragapult ex" archetype with icons=["dragapult"], match the Dragapult
 * card in the list, not Pidgeot or Manaphy). When no name match exists,
 * fall back to the Pokémon card with the highest qty in the list, then
 * highest HP among that tier.
 */
export function metaPrimaryCard(
  cards: DeckCard[],
  archetypeIcons: string[],
): MetaPrimaryCard | null {
  const pokemon = cards.filter((c) => c.category === "pokemon");
  if (!pokemon.length) return null;

  // Normalize icon slugs into searchable tokens. Limitless icons like
  // "ogerpon-teal" become ["ogerpon", "teal"]; we mostly care about the
  // pokémon name root, so include the full slug too for exact matches.
  const iconTokens = new Set<string>();
  for (const ic of archetypeIcons) {
    iconTokens.add(ic.toLowerCase());
    for (const t of tokens(ic)) iconTokens.add(t);
  }

  const annotated = pokemon.map((c) => {
    const entry = resolve(c);
    const nameToks = tokens(c.name);
    // Icon match if any name token equals or contains an icon token.
    // (Avoids matching "munkidori" against the "n" in "n's zoroark".)
    const iconMatch = nameToks.some((nt) =>
      Array.from(iconTokens).some((it) => it.length >= 3 && (nt === it || nt.startsWith(it)))
    );
    const hp = entry?.hp == null ? 0 : Number(entry.hp) || 0;
    return { c, entry, iconMatch, hp };
  });

  // Pick the strongest candidate. Priority:
  //   1. Icon-matched card with highest HP
  //   2. Otherwise: highest qty in the list, tie-broken by HP
  const iconMatches = annotated.filter((a) => a.iconMatch);
  let best;
  if (iconMatches.length) {
    iconMatches.sort((a, b) => b.hp - a.hp || b.c.qty - a.c.qty);
    best = iconMatches[0];
  } else {
    const sorted = [...annotated].sort(
      (a, b) => b.c.qty - a.c.qty || b.hp - a.hp,
    );
    best = sorted[0];
  }
  if (!best?.entry?.set_id) return null;

  return {
    imageUrl: cardImageSmall(best.entry.set_id, best.c.number),
    types: best.entry.types ?? [],
    name: best.c.name,
  };
}

/** Background color for the energy-type avatar circle. Aligned with the
 *  Pokémon TCG type palette so e.g. Fire is red-orange, Water blue, etc. */
export const TYPE_COLOR: Record<string, string> = {
  Fire: "#E1542D",
  Water: "#3F8FCC",
  Grass: "#5BAA4F",
  Lightning: "#E8C232",
  Psychic: "#B061BD",
  Fighting: "#BD5A2A",
  Darkness: "#318C98",
  Metal: "#7E8B96",
  Dragon: "#C7A126",
  Fairy: "#D86CB0",
  Colorless: "#B0A89E",
};

export function typeColor(types: string[] | undefined): string {
  if (!types || types.length === 0) return TYPE_COLOR.Colorless;
  return TYPE_COLOR[types[0]] ?? TYPE_COLOR.Colorless;
}
