import archetypesRaw from "@/data/meta-archetypes.json";
import metaDecksRaw from "@/data/meta-decks.json";
import {
  metaPrimaryCard,
  metaTopPokemonByCount,
  typeColor,
  type MetaAvatar,
} from "@/lib/metaPrimaryCard";
import { formatMetaVariantDate } from "@/lib/formatMetaVariantDate";

/**
 * "Appears in" — server-side index over the bundled meta-decks data, used
 * by the card detail page to surface every top deck variant that runs the
 * exact printing currently being viewed (setCode + number match).
 *
 * v1 only covers meta archetypes; public user decks will join this stream
 * once we have an indexable card column on saved_decks.
 */

interface Archetype {
  id: string;
  name: string;
  annotation?: string;
  icons?: string;
  total_entries: number;
  representation_pct: number;
}

interface DeckCard {
  qty: number;
  name: string;
  setCode: string;
  number: string;
  category: "pokemon" | "trainer" | "energy";
}

interface MetaDeckVariant {
  creator?: string;
  placing?: number;
  date?: string;
  variantName?: string | null;
  cards: DeckCard[];
}

interface MetaDeck {
  id: string;
  name: string;
  cards: DeckCard[];
  variants?: MetaDeckVariant[];
}

export interface CardAppearance {
  /** Stable React key — `${archetypeId}-v${variantIndex}` (variantIndex 0-based). */
  id: string;
  /** URL into the variant detail page. */
  href: string;
  archetypeName: string;
  annotation?: string;
  variantName: string | null;
  iconUrl: string | null;
  iconBg: string;
  placingLine: string | null;
  competitionName: string | null;
  dateLine: string | null;
  creator: string;
  cardImageUrl: string | null;
  secondaryAvatars: MetaAvatar[];
}

const ARCHETYPES = (archetypesRaw as Archetype[]).slice().sort(
  (a, b) => b.representation_pct - a.representation_pct,
);
const META_DECKS_BY_ID = new Map(
  (metaDecksRaw as MetaDeck[]).map((d) => [d.id, d]),
);

function placingLabel(p?: number): string | null {
  if (!p || p <= 0) return null;
  if (p % 100 >= 11 && p % 100 <= 13) return `${p}th`;
  switch (p % 10) {
    case 1: return `${p}st`;
    case 2: return `${p}nd`;
    case 3: return `${p}rd`;
    default: return `${p}th`;
  }
}

function parseIcons(arch: Archetype): string[] {
  if (!arch.icons) return [];
  try {
    return JSON.parse(arch.icons) as string[];
  } catch {
    return [];
  }
}

interface Match {
  archetype: Archetype;
  variant: MetaDeckVariant;
  variantIndex: number;
}

/**
 * Walk every (archetype, variant) pair, keeping those whose card list
 * contains the exact printing (setCode + number). Ranked by archetype
 * representation (more popular first), then placing within an archetype
 * (1st, 2nd, …). Variants with no placing sink to the bottom.
 */
function collectMatches(setCode: string, number: string): Match[] {
  const matches: Match[] = [];
  for (const arch of ARCHETYPES) {
    const deck = META_DECKS_BY_ID.get(arch.id);
    if (!deck?.variants) continue;
    deck.variants.forEach((v, i) => {
      const hit = v.cards.some(
        (c) => c.setCode === setCode && c.number === number,
      );
      if (hit) matches.push({ archetype: arch, variant: v, variantIndex: i });
    });
  }
  // Stable sort: archetype rep already preserved by iteration order; then
  // by placing within an archetype.
  matches.sort((a, b) => {
    if (a.archetype.id !== b.archetype.id) {
      return b.archetype.representation_pct - a.archetype.representation_pct;
    }
    const ap = a.variant.placing ?? Number.MAX_SAFE_INTEGER;
    const bp = b.variant.placing ?? Number.MAX_SAFE_INTEGER;
    return ap - bp;
  });
  return matches;
}

function buildAppearance(m: Match): CardAppearance {
  const { archetype, variant, variantIndex } = m;
  const iconList = parseIcons(archetype);
  const archetypeIconSlug = iconList[0] ?? null;
  const iconUrl = archetypeIconSlug
    ? `https://r2.limitlesstcg.net/pokemon/gen9/${archetypeIconSlug}.png`
    : null;

  const archetypePrimary = metaPrimaryCard(
    variant.cards.length > 0 ? variant.cards : [],
    iconList,
  );
  const iconBg = typeColor(archetypePrimary?.types);
  const cardImageUrl = archetypePrimary?.imageUrl ?? null;

  const placing = placingLabel(variant.placing);
  const placingLine = placing ? `${placing} Place` : null;

  const rawDate = (variant.date ?? "").trim();
  const dashIdx = rawDate.indexOf(" - ");
  const datePart = dashIdx >= 0 ? rawDate.slice(0, dashIdx) : rawDate;
  const competitionName =
    dashIdx >= 0 ? rawDate.slice(dashIdx + 3).trim() : null;
  const dateLine = formatMetaVariantDate(datePart || null);

  const secondaryAvatars = metaTopPokemonByCount(
    variant.cards,
    5,
    archetypePrimary ? [archetypePrimary.name] : [],
  );

  return {
    id: `${archetype.id}-v${variantIndex}`,
    href: `/meta-archetypes/${archetype.id}/${variantIndex + 1}`,
    archetypeName: archetype.name,
    annotation: archetype.annotation,
    variantName: (variant.variantName ?? "").trim() || null,
    iconUrl,
    iconBg,
    placingLine,
    competitionName,
    dateLine,
    creator: (variant.creator ?? "").trim() || "Trainer",
    cardImageUrl,
    secondaryAvatars,
  };
}

export function findCardAppearances(
  setCode: string,
  number: string,
  offset: number,
  limit: number,
): { items: CardAppearance[]; hasMore: boolean; total: number } {
  if (!setCode || !number) return { items: [], hasMore: false, total: 0 };
  const matches = collectMatches(setCode, number);
  const slice = matches.slice(offset, offset + limit);
  return {
    items: slice.map(buildAppearance),
    hasMore: offset + slice.length < matches.length,
    total: matches.length,
  };
}
