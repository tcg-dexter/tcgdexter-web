import { notFound } from "next/navigation";
import Link from "next/link";
import archetypesRaw from "@/data/meta-archetypes.json";
import metaDecksRaw from "@/data/meta-decks.json";
import { metaPrimaryCard, typeColor } from "@/lib/metaPrimaryCard";
import { cardImageUrlFor } from "@/lib/primaryCardImage";
import MetaProfileHeader from "./MetaProfileHeader";
import MetaVariantCard from "./MetaVariantCard";

interface Archetype {
  id: string;
  name: string;
  annotation?: string;
  total_entries: number;
  top_cut_entries: number;
  representation_pct: number;
  conversion_rate: number;
  wins: number;
  losses: number;
  ties: number;
  last_updated: string;
  velocity?: number;
  icons?: string;
  image_url?: string;
}

interface DeckCard {
  qty: number;
  name: string;
  setCode: string;
  number: string;
  category: "pokemon" | "trainer" | "energy";
}

interface MetaDeckVariant {
  listId?: number;
  creator?: string;
  placing?: number;
  date?: string;
  cards: DeckCard[];
}

interface MetaDeck {
  id: string;
  name: string;
  cards: DeckCard[];
  variants?: MetaDeckVariant[];
}

const archetypes = (archetypesRaw as Archetype[]).sort(
  (a, b) => b.total_entries - a.total_entries,
);
const top30 = archetypes.slice(0, 30);

export function generateStaticParams() {
  return top30.map((a) => ({ slug: a.id }));
}

function getWinRate(a: Archetype): number {
  const total = a.wins + a.losses + a.ties;
  return total > 0 ? a.wins / total : 0;
}

function buildDeckList(cards: DeckCard[]): string {
  const groups: Record<string, DeckCard[]> = { pokemon: [], trainer: [], energy: [] };
  for (const card of cards) groups[card.category]?.push(card);
  const lines: string[] = [];
  for (const [label, group] of [
    ["Pokémon", groups.pokemon],
    ["Trainer", groups.trainer],
    ["Energy", groups.energy],
  ] as [string, DeckCard[]][]) {
    if (group.length === 0) continue;
    if (lines.length > 0) lines.push("");
    lines.push(`${label}: ${group.reduce((s, c) => s + c.qty, 0)}`);
    for (const c of group) lines.push(`${c.qty} ${c.name} ${c.setCode} ${c.number}`);
  }
  return lines.join("\n");
}

function placingLabel(placing?: number): string | null {
  if (!placing || placing <= 0) return null;
  const v = placing;
  if (v % 100 >= 11 && v % 100 <= 13) return `${v}th`;
  switch (v % 10) {
    case 1: return `${v}st`;
    case 2: return `${v}nd`;
    case 3: return `${v}rd`;
    default: return `${v}th`;
  }
}

function countsFor(cards: DeckCard[]): { pokemon: number; trainer: number; energy: number } {
  const c = { pokemon: 0, trainer: 0, energy: 0 };
  for (const card of cards) c[card.category] += card.qty;
  return c;
}

/**
 * Top N most-common cards across a set of deck-list variants, scored by
 * how many variants include the card (primary) then by total copies
 * across those variants (tie-break). Returns image URLs in order
 * (most-common first), filtering out any card the local DB can't
 * resolve to a pokemontcg.io image.
 */
function topCardImagesAcrossVariants(
  variants: { cards: DeckCard[] }[],
  n: number,
): string[] {
  type Agg = { card: DeckCard; copies: number; variants: number };
  const acc = new Map<string, Agg>();
  for (const v of variants) {
    const seenThisVariant = new Set<string>();
    for (const c of v.cards) {
      const key = `${c.name}|${c.setCode}|${c.number}`;
      const existing = acc.get(key);
      if (existing) {
        existing.copies += c.qty;
        if (!seenThisVariant.has(key)) existing.variants += 1;
      } else {
        acc.set(key, { card: c, copies: c.qty, variants: 1 });
      }
      seenThisVariant.add(key);
    }
  }
  const ranked = Array.from(acc.values()).sort((a, b) => {
    if (b.variants !== a.variants) return b.variants - a.variants;
    if (b.copies !== a.copies) return b.copies - a.copies;
    return a.card.name.localeCompare(b.card.name);
  });
  const out: string[] = [];
  for (const entry of ranked) {
    if (out.length >= n) break;
    const url = cardImageUrlFor(entry.card);
    if (url) out.push(url);
  }
  return out;
}

/**
 * Archetype landing page. Pure Twitter-style profile: banner + avatar +
 * bio + "posts feed" of the top-5 deck list preview cards. Each card
 * deep-links to /meta-decks/[slug]/[variantIndex] which renders the
 * full deck profile for that specific list.
 *
 * No deck profile content (Overview, accordions, deck-list module, shop
 * matches) renders on this page — those live on the per-variant route.
 */
export default async function MetaDeckDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const arch = top30.find((a) => a.id === slug);
  if (!arch) notFound();

  const winRate = getWinRate(arch);
  const deckData = (metaDecksRaw as MetaDeck[]).find((d) => d.id === arch.id);

  // Parse archetype icons (e.g. `["dragapult"]`) for the avatar + primary
  // card detection. Mirrors the logic in app/meta-decks/page.tsx so the
  // landing page and index page agree on which card to feature.
  let iconList: string[] = [];
  try {
    iconList = arch.icons ? (JSON.parse(arch.icons) as string[]) : [];
  } catch {
    iconList = [];
  }
  const iconUrl = iconList[0]
    ? `https://r2.limitlesstcg.net/pokemon/gen9/${iconList[0]}.png`
    : null;

  const variantList = deckData?.variants ?? [];
  // Use the FIRST variant's primary card for the avatar color hint.
  const firstCards = variantList[0]?.cards ?? deckData?.cards ?? [];
  const archetypePrimary = metaPrimaryCard(firstCards, iconList);
  const iconBg = typeColor(archetypePrimary?.types);

  // Banner: the 7 most common cards across the top-5 deck lists,
  // resolved to pokemontcg.io image URLs. Falls back to whatever the
  // archetype's preview card image is when no variants exist (rare).
  const topFiveVariants = variantList.slice(0, 5);
  let bannerCards = topCardImagesAcrossVariants(topFiveVariants, 7);
  if (bannerCards.length === 0) {
    const fallback = archetypePrimary?.imageUrl ?? arch.image_url ?? null;
    if (fallback) bannerCards = [fallback];
  }

  // Build per-variant cards for the top-5 grid. variantIndex on the URL
  // is 1-based for human friendliness (1st variant → /1, not /0).
  const variantCards = variantList.slice(0, 5).map((v, i) => {
    const variantPrimary = metaPrimaryCard(v.cards, iconList);
    const placing = placingLabel(v.placing);
    const date = (v.date ?? "").trim();
    const contextLabel =
      placing && date
        ? `${placing} · ${date}`
        : placing ?? (date || null);
    return {
      id: `${arch.id}-v${i}`,
      href: `/meta-decks/${arch.id}/${i + 1}`,
      contextLabel,
      creator: (v.creator ?? "").trim() || "Trainer",
      deckList: buildDeckList(v.cards),
      cardImageUrl: variantPrimary?.imageUrl ?? null,
      counts: countsFor(v.cards),
    };
  });

  return (
    <main className="min-h-dvh flex flex-col bg-bg">
      <MetaProfileHeader
        name={arch.name}
        annotation={arch.annotation ?? ""}
        bannerCards={bannerCards}
        iconUrl={iconUrl}
        iconBg={iconBg}
        representationPct={`${(arch.representation_pct * 100).toFixed(1)}%`}
        topCutEntries={arch.top_cut_entries}
        conversionRate={`${(arch.conversion_rate * 100).toFixed(1)}%`}
        winRate={`${(winRate * 100).toFixed(0)}%`}
        winRateHighlight={winRate >= 0.55}
        wins={arch.wins}
        losses={arch.losses}
        ties={arch.ties}
        totalEntries={arch.total_entries}
        preBanner={
          /* Circular back button — overlays the top-left of the banner.
             Translucent black so it reads against any card art. */
          <Link
            href="/meta-decks"
            aria-label="Back to Top 30 Meta Decks"
            className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-black/50 backdrop-blur-md text-white hover:bg-black/70 transition-colors shadow-sm"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </Link>
        }
      >
        {variantCards.length > 0 ? (
          <section aria-label="Top deck lists" className="pb-12">
            <h2 className="text-sm font-semibold text-text-primary mb-3">
              Top {variantCards.length} Deck List{variantCards.length === 1 ? "" : "s"}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {variantCards.map((v) => (
                <MetaVariantCard
                  key={v.id}
                  id={v.id}
                  href={v.href}
                  archetypeName={arch.name}
                  annotation={arch.annotation}
                  contextLabel={v.contextLabel}
                  creator={v.creator}
                  deckList={v.deckList}
                  cardImageUrl={v.cardImageUrl}
                  iconUrl={iconUrl}
                  iconBg={iconBg}
                  counts={v.counts}
                />
              ))}
            </div>
          </section>
        ) : (
          <p className="pb-12 text-sm text-text-muted italic">
            Deck lists not yet available for this archetype.
          </p>
        )}
      </MetaProfileHeader>
    </main>
  );
}
