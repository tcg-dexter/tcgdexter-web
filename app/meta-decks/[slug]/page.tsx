import { notFound } from "next/navigation";
import Link from "next/link";
import archetypesRaw from "@/data/meta-archetypes.json";
import metaDecksRaw from "@/data/meta-decks.json";
import DeckProfileView from "@/app/components/DeckProfileView";
import { buildMetaAnalysis } from "@/lib/buildMetaAnalysis";
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
  // 11–13 are special (11th, 12th, 13th not 11st/12nd/13rd).
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
  // profile page and index page agree on which card to feature.
  let iconList: string[] = [];
  try {
    iconList = arch.icons ? (JSON.parse(arch.icons) as string[]) : [];
  } catch {
    iconList = [];
  }
  const iconUrl = iconList[0]
    ? `https://r2.limitlesstcg.net/pokemon/gen9/${iconList[0]}.png`
    : null;

  // Prefer the new `variants` shape; fall back to the legacy single `cards`
  // array for archetypes that haven't been re-scraped yet.
  const variantCardSets: DeckCard[][] =
    deckData?.variants && deckData.variants.length > 0
      ? deckData.variants.map((v) => v.cards)
      : deckData?.cards
        ? [deckData.cards]
        : [];

  const cards = variantCardSets[0] ?? [];
  const deckList = buildDeckList(cards);

  // Use the FIRST variant's primary card for the banner + avatar coloring.
  // Each variant card below uses its own primary so visually distinct
  // tech choices read differently.
  const archetypePrimary = metaPrimaryCard(cards, iconList);
  const bannerCardImage = archetypePrimary?.imageUrl ?? arch.image_url ?? null;
  const iconBg = typeColor(archetypePrimary?.types);

  const analysis = buildMetaAnalysis(cards, {
    name: arch.name,
    rank,
    conversionRate: arch.conversion_rate,
    representationPct: arch.representation_pct,
  });

  // Fallback profiledAt — meta decks use last_updated date
  const profiledAt = arch.last_updated
    ? new Date(arch.last_updated).toISOString()
    : new Date().toISOString();

  // Build per-variant cards for the top-5 grid. Placing (e.g. "2nd") is
  // folded into the contextLabel so the header right slot is free for the
  // copy-list action.
  const variantList = deckData?.variants ?? [];
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
      contextLabel,
      creator: (v.creator ?? "").trim() || "Trainer",
      deckList: buildDeckList(v.cards),
      cardImageUrl: variantPrimary?.imageUrl ?? null,
      counts: countsFor(v.cards),
    };
  });

  // Full Twitter-profile-style header: banner + avatar + bio +
  // top-5 variant cards (rendered as a child of the bio block).
  const headerSlot = (
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
        <section aria-label="Top deck lists">
          <h2 className="text-sm font-semibold text-text-primary mb-3">
            Top {variantCards.length} Deck List{variantCards.length === 1 ? "" : "s"}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {variantCards.map((v) => (
              <MetaVariantCard
                key={v.id}
                id={v.id}
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
        <p className="text-sm text-text-muted italic">
          Deck lists not yet available for this archetype.
        </p>
      )}
    </MetaProfileHeader>
  );

  return (
    <DeckProfileView
      variant="meta"
      deckList={deckList}
      analysis={analysis}
      profiledAt={profiledAt}
      pageTitle={arch.name}
      subtitle={false}
      headerSlot={headerSlot}
      footerCta={null}
    />
  );
}
