import { notFound } from "next/navigation";
import archetypesRaw from "@/data/meta-archetypes.json";
import metaDecksRaw from "@/data/meta-decks.json";
import DeckProfileView from "@/app/components/DeckProfileView";
import BackButton from "@/app/components/ui/BackButton";
import { buildMetaAnalysis } from "@/lib/buildMetaAnalysis";
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

/** Pre-render every (archetype, variant) pair. variantIndex is 1-based
 *  in the URL so links like /meta-decks/dragapult-ex/1 read naturally
 *  to a human eye. */
export function generateStaticParams() {
  const out: { slug: string; variantIndex: string }[] = [];
  for (const arch of top30) {
    const deck = (metaDecksRaw as MetaDeck[]).find((d) => d.id === arch.id);
    const variants = deck?.variants ?? [];
    for (let i = 0; i < variants.length; i++) {
      out.push({ slug: arch.id, variantIndex: String(i + 1) });
    }
  }
  return out;
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

export default async function MetaVariantPage({
  params,
}: {
  params: Promise<{ slug: string; variantIndex: string }>;
}) {
  const { slug, variantIndex } = await params;
  const arch = top30.find((a) => a.id === slug);
  if (!arch) notFound();

  const idx = Number.parseInt(variantIndex, 10);
  if (!Number.isFinite(idx) || idx < 1) notFound();

  const deckData = (metaDecksRaw as MetaDeck[]).find((d) => d.id === arch.id);
  const variants = deckData?.variants ?? [];
  // URL is 1-based; data is 0-based.
  const variant = variants[idx - 1];
  if (!variant) notFound();

  const cards = variant.cards;
  const deckList = buildDeckList(cards);

  const rank = top30.findIndex((a) => a.id === arch.id) + 1;
  const analysis = buildMetaAnalysis(cards, {
    name: arch.name,
    rank,
    conversionRate: arch.conversion_rate,
    representationPct: arch.representation_pct,
  });

  // Profiled-at = the snapshot date the archetype was last refreshed.
  const profiledAt = arch.last_updated
    ? new Date(arch.last_updated).toISOString()
    : new Date().toISOString();

  const creator = (variant.creator ?? "").trim() || "Trainer";
  const placing = placingLabel(variant.placing);
  const archetypeFullName = arch.annotation
    ? `${arch.name} ${arch.annotation}`
    : arch.name;

  // Subtitle: "1st by Francisco Osorio · 16th May 2026 - Regional Campinas"
  const subtitleParts: string[] = [];
  if (placing) subtitleParts.push(`${placing} by ${creator}`);
  else subtitleParts.push(`by ${creator}`);
  const dateLabel = formatMetaVariantDate(variant.date);
  if (dateLabel) subtitleParts.push(dateLabel);
  const subtitleText = subtitleParts.join(" · ");

  const initials = creator.trim().charAt(0).toUpperCase() || "T";
  const AVATAR_PALETTE = [
    "#3b6fd4", "#d43b9a", "#27ae60", "#e67e22", "#9b59b6", "#c0392b",
  ];
  const avatarBg = AVATAR_PALETTE[
    creator.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) %
      AVATAR_PALETTE.length
  ];

  return (
    <DeckProfileView
      variant="meta"
      deckList={deckList}
      analysis={analysis}
      profiledAt={profiledAt}
      pageTitle={archetypeFullName}
      preTitle={
        <BackButton
          href={`/meta-decks/${arch.id}`}
          ariaLabel={`Back to ${archetypeFullName}`}
        />
      }
      titleLeading={
        <span
          className="w-9 h-9 sm:w-10 sm:h-10 rounded-full shrink-0 inline-flex items-center justify-center text-sm font-bold text-white"
          style={{ background: avatarBg }}
          aria-hidden
        >
          {initials}
        </span>
      }
      subtitle={
        <span className="text-text-secondary">{subtitleText}</span>
      }
      footerCta={null}
    />
  );
}
