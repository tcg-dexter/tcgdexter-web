import { notFound } from "next/navigation";
import archetypesRaw from "@/data/meta-archetypes.json";
import metaDecksRaw from "@/data/meta-decks.json";
import { metaPrimaryCard, metaTopPokemonByCount, typeColor } from "@/lib/metaPrimaryCard";
import { cardImageUrlFor } from "@/lib/primaryCardImage";
import ThemeColor from "@/app/components/ThemeColor";
import BackButton from "@/app/components/ui/BackButton";
import MetaProfileHeader from "./MetaProfileHeader";
import MetaVariantCard from "./MetaVariantCard";
import { formatMetaVariantDate } from "@/lib/formatMetaVariantDate";

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
  variantName?: string | null;
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
 * Top N cards by aggregate copy count across a set of deck-list variants.
 * Sums every printing's qty across all variants, sorts most → least,
 * tie-breaks by number of variants the card appears in (broader consensus
 * wins ties) then alphabetically. Skips any card the local DB can't
 * resolve to a pokemontcg.io image so the banner always renders real art.
 * Each entry carries its category so callers can group the fan by
 * energy / trainer / pokemon (left → right toward the title card).
 */
function topCardsAcrossVariants(
  variants: { cards: DeckCard[] }[],
  n: number,
): { url: string; category: DeckCard["category"] }[] {
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
    if (b.copies !== a.copies) return b.copies - a.copies;
    if (b.variants !== a.variants) return b.variants - a.variants;
    return a.card.name.localeCompare(b.card.name);
  });
  const out: { url: string; category: DeckCard["category"] }[] = [];
  for (const entry of ranked) {
    if (out.length >= n) break;
    const url = cardImageUrlFor(entry.card);
    if (url) out.push({ url, category: entry.card.category });
  }
  return out;
}

/**
 * Arrange the 6 non-title banner picks across the fan so categories are
 * spatially grouped, reading left → right: energy → trainer → pokemon →
 * (title card pinned to slot 7 by the caller). Within each category the
 * most-popular card sits closest to the title card, so the eye flows
 * from the boldest art at the right inward through related categories.
 */
function arrangeBannerByCategory(
  picks: { url: string; category: DeckCard["category"] }[],
): string[] {
  const buckets: Record<DeckCard["category"], string[]> = {
    energy: [],
    trainer: [],
    pokemon: [],
  };
  for (const p of picks) buckets[p.category].push(p.url);
  // Each bucket arrives in popularity-descending order. Reverse so the
  // most popular within the bucket lands at the inner (right) edge,
  // closest to the next group / title card.
  return [
    ...buckets.energy.reverse(),
    ...buckets.trainer.reverse(),
    ...buckets.pokemon.reverse(),
  ];
}

/**
 * Archetype landing page. Pure Twitter-style profile: banner + avatar +
 * bio + "posts feed" of the top-5 deck list preview cards. Each card
 * deep-links to /meta-archetypes/[slug]/[variantIndex] which renders the
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
  // card detection. Mirrors the logic in app/meta-archetypes/page.tsx so the
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
  // resolved to pokemontcg.io image URLs. The archetype's "title card"
  // (the same primary image we feature elsewhere on the page) is pinned
  // to the last slot so it paints on top of the fan with the highest
  // z-index. Falls back to whatever the archetype's preview card image
  // is when no variants exist (rare).
  const topFiveVariants = variantList.slice(0, 5);
  const titleCardImage = archetypePrimary?.imageUrl ?? arch.image_url ?? null;

  let bannerCards: string[] = [];
  if (titleCardImage) {
    // Ask for 8 (instead of 7) so we still get 6 strong ranked picks
    // even if the title card would have made the natural top 7.
    const ranked = topCardsAcrossVariants(topFiveVariants, 8)
      .filter((p) => p.url !== titleCardImage)
      .slice(0, 6);
    bannerCards = [...arrangeBannerByCategory(ranked), titleCardImage];
  } else {
    const ranked = topCardsAcrossVariants(topFiveVariants, 7);
    bannerCards = arrangeBannerByCategory(ranked);
  }

  // Build per-variant cards for the top-5 grid. variantIndex on the URL
  // is 1-based for human friendliness (1st variant → /1, not /0).
  const variantCards = variantList.slice(0, 12).map((v, i) => {
    const variantPrimary = metaPrimaryCard(v.cards, iconList);
    const placing = placingLabel(v.placing);
    const placingLine = placing ? `${placing} Place` : null;
    // Legacy variant `date` arrives as "<date> - <competition>" (e.g.
    // "16th May 2026 - Regional Campinas"); newer scrapes emit a raw ISO
    // string with no competition name. Split when the dash is present so
    // the preview card can stack date + competition on their own lines.
    const rawDate = (v.date ?? "").trim();
    const dashIdx = rawDate.indexOf(" - ");
    const datePart = dashIdx >= 0 ? rawDate.slice(0, dashIdx) : rawDate;
    const competitionName = dashIdx >= 0 ? rawDate.slice(dashIdx + 3).trim() : null;
    const dateLine = formatMetaVariantDate(datePart || null);
    // Ask for extras so the AvatarStack can shift forward when a sprite
    // URL 404s on the limitless host (some forms / regionals aren't there).
    const secondaryAvatars = metaTopPokemonByCount(
      v.cards,
      5,
      archetypePrimary ? [archetypePrimary.name] : [],
    );
    return {
      id: `${arch.id}-v${i}`,
      href: `/meta-archetypes/${arch.id}/${i + 1}`,
      placingLine,
      competitionName,
      dateLine,
      variantName: (v.variantName ?? "").trim() || null,
      creator: (v.creator ?? "").trim() || "Trainer",
      cardImageUrl: variantPrimary?.imageUrl ?? null,
      counts: countsFor(v.cards),
      secondaryAvatars,
    };
  });

  return (
    <main className="min-h-dvh flex flex-col bg-bg">
      {/* Paint the mobile sticky toolbar in the banner color so the
          toolbar, the iOS status bar (set via ThemeColor below), and the
          banner itself all read as one continuous surface. The toolbar
          stays sticky and in layout flow, but the visual seam between
          it and the banner disappears because both are the same color.
          The toolbar is `xl:hidden` already, so this only affects
          below-xl widths. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `[data-site-toolbar]{background:${iconBg ?? "#B0A89E"};backdrop-filter:none;-webkit-backdrop-filter:none}[data-site-toolbar] button[aria-label="Toggle navigation menu"]{color:#fff}`,
        }}
      />
      {/* Match the iOS Safari chrome + status-bar color to the banner
          background so the page reads as one continuous surface from
          the time/battery row down through the banner. Falls back to
          the same neutral the banner uses when iconBg is unresolved. */}
      <ThemeColor color={iconBg ?? "#B0A89E"} />
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
          <BackButton href="/meta-archetypes" ariaLabel="Back to Top Meta Archetypes" />
        }
      >
        {variantCards.length > 0 ? (
          <section aria-label="Top deck lists" className="pb-12">
            <h2 className="text-sm font-semibold text-text-primary mb-3">
              Top Deck Lists
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {variantCards.map((v) => (
                <MetaVariantCard
                  key={v.id}
                  id={v.id}
                  href={v.href}
                  archetypeId={arch.id}
                  archetypeName={arch.name}
                  annotation={arch.annotation}
                  variantName={v.variantName}
                  iconUrl={iconUrl}
                  iconBg={iconBg}
                  placingLine={v.placingLine}
                  competitionName={v.competitionName}
                  dateLine={v.dateLine}
                  creator={v.creator}
                  cardImageUrl={v.cardImageUrl}
                  counts={v.counts}
                  secondaryAvatars={v.secondaryAvatars}
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
