import { notFound } from "next/navigation";
import archetypesRaw from "@/data/meta-archetypes.json";
import metaDecksRaw from "@/data/meta-decks.json";
import DeckProfileView from "@/app/components/DeckProfileView";
import BackButton from "@/app/components/ui/BackButton";
import { buildMetaAnalysis } from "@/lib/buildMetaAnalysis";
import { formatMetaVariantDate } from "@/lib/formatMetaVariantDate";
import { metaPrimaryCard, typeColor } from "@/lib/metaPrimaryCard";

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
  icons?: string;
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

/** Pre-render every (archetype, variant) pair. variantIndex is 1-based
 *  in the URL so links like /meta-archetypes/dragapult-ex/1 read naturally
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

  // Avatar — use the same primary-pokemon sprite + type-color background
  // as the /meta-archetypes preview cells. `arch.icons` is a JSON array
  // saved by the Limitless scraper (e.g. `["dragapult"]`); the first
  // entry resolves to a sprite on the limitless CDN.
  let iconList: string[] = [];
  try {
    iconList = arch.icons ? (JSON.parse(arch.icons) as string[]) : [];
  } catch {
    iconList = [];
  }
  const variantPrimary = metaPrimaryCard(cards, iconList);
  const avatarSpriteUrl = iconList[0]
    ? `https://r2.limitlesstcg.net/pokemon/gen9/${iconList[0]}.png`
    : null;
  const avatarBg = typeColor(variantPrimary?.types);

  // Credits stack — Limitless legacy `date` is "<date> - <event>"; newer
  // scrapes are ISO with no event. Split when the dash is present so the
  // place / event / date can render on their own lines.
  const rawDate = (variant.date ?? "").trim();
  const dashIdx = rawDate.indexOf(" - ");
  const datePart = dashIdx >= 0 ? rawDate.slice(0, dashIdx) : rawDate;
  const eventName = dashIdx >= 0 ? rawDate.slice(dashIdx + 3).trim() : null;
  const dateLabel = formatMetaVariantDate(datePart || null);
  const placeEvent = [placing ? `${placing} Place` : null, eventName]
    .filter(Boolean)
    .join(" - ");

  const credits = (
    <div className="flex flex-col items-center gap-0.5 text-center text-[17.5px] text-text-secondary">
      <span className="font-semibold text-text-primary">{creator}</span>
      {placeEvent && <span>{placeEvent}</span>}
      {dateLabel && <span className="text-text-muted">{dateLabel}</span>}
    </div>
  );

  return (
    <DeckProfileView
      variant="meta"
      deckList={deckList}
      analysis={analysis}
      profiledAt={profiledAt}
      pageTitle={archetypeFullName}
      preTitle={
        <BackButton
          href={`/meta-archetypes/${arch.id}`}
          ariaLabel={`Back to ${archetypeFullName}`}
        />
      }
      titleLeading={
        avatarSpriteUrl ? (
          <span
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-full shrink-0 inline-flex items-center justify-center overflow-hidden ring-1 ring-black/[0.06]"
            style={{ background: avatarBg }}
            aria-hidden
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={avatarSpriteUrl}
              alt=""
              className="w-[28px] h-[28px] sm:w-[32px] sm:h-[32px] object-contain"
            />
          </span>
        ) : (
          <span
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-full shrink-0"
            style={{ background: avatarBg }}
            aria-hidden
          />
        )
      }
      subtitle={false}
      postOverviewSlot={credits}
      footerCta={null}
    />
  );
}
