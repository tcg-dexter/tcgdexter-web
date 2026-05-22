import { notFound } from "next/navigation";
import Link from "next/link";
import archetypesRaw from "@/data/meta-archetypes.json";
import metaDecksRaw from "@/data/meta-decks.json";
import { metaPrimaryCard, typeColor } from "@/lib/metaPrimaryCard";
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

function getRank(id: string): number {
  return top30.findIndex((a) => a.id === id) + 1;
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

  const rank = getRank(arch.id);
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
  // Use the FIRST variant's primary card for the banner + avatar coloring.
  const firstCards = variantList[0]?.cards ?? deckData?.cards ?? [];
  const archetypePrimary = metaPrimaryCard(firstCards, iconList);
  const bannerCardImage = archetypePrimary?.imageUrl ?? arch.image_url ?? null;
  const iconBg = typeColor(archetypePrimary?.types);

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
        rank={rank}
        cardImageUrl={bannerCardImage}
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
          <Link
            href="/meta-decks"
            className="text-xs font-semibold text-text-secondary hover:text-text-primary transition-colors underline-offset-2 hover:underline"
          >
            ← Top 30 Meta Decks
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
