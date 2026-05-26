import archetypesRaw from "@/data/meta-archetypes.json";
import metaDecksRaw from "@/data/meta-decks.json";
import SectionHeader from "@/app/components/ui/SectionHeader";
import MetaDecksClient, { type MetaDeckItem } from "./MetaDecksClient";
import { metaPrimaryCard, typeColor } from "@/lib/metaPrimaryCard";

interface Archetype {
  id: string;
  name: string;
  total_entries: number;
  top_cut_entries: number;
  representation_pct: number;
  last_updated: string;
  image_url?: string;
  icons?: string;
}

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
  variants?: { cards: DeckCard[]; creator?: string }[];
}

export default function MetaDecksPage() {
  const archetypes = (archetypesRaw as Archetype[])
    .sort((a, b) => b.total_entries - a.total_entries)
    .slice(0, 30);

  const metaDecks = metaDecksRaw as MetaDeck[];
  const lastUpdated = archetypes[0]?.last_updated;

  const items: MetaDeckItem[] = archetypes.map((arch) => {
    const deckData = metaDecks.find((d) => d.id === arch.id);
    const cards = deckData?.variants?.[0]?.cards ?? deckData?.cards ?? [];
    // Parse the icons string (e.g. `["dragapult"]`) saved by the
    // Limitless scraper. Use as a hint for matching the deck's
    // primary pokémon card in the list.
    let iconList: string[] = [];
    try {
      iconList = arch.icons ? (JSON.parse(arch.icons) as string[]) : [];
    } catch {
      iconList = [];
    }
    const primary = metaPrimaryCard(cards, iconList);
    const cardImage = primary?.imageUrl ?? arch.image_url ?? null;
    const iconBg = typeColor(primary?.types);
    const iconUrl = iconList[0]
      ? `https://r2.limitlesstcg.net/pokemon/gen9/${iconList[0]}.png`
      : null;
    const creators: string[] = [];
    for (const v of deckData?.variants ?? []) {
      const c = (v.creator ?? "").trim() || "Trainer";
      if (!creators.includes(c)) creators.push(c);
      if (creators.length >= 5) break;
    }
    const counts = { pokemon: 0, trainer: 0, energy: 0 };
    for (const c of cards) counts[c.category] += c.qty;
    return {
      id: arch.id,
      name: arch.name,
      image_url: cardImage,
      icon_url: iconUrl,
      icon_bg: iconBg,
      representation_pct: arch.representation_pct,
      creators,
      counts,
    };
  });

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 pt-[calc(env(safe-area-inset-top)_+_1.68rem)] md:pt-[calc(env(safe-area-inset-top)_+_3rem)] pb-24">
      <div className="mb-6">
        <SectionHeader title="Top 30 Meta Decks" />
      </div>

      <MetaDecksClient items={items} />

      {lastUpdated && (
        <p className="mt-4 text-xs text-text-muted text-center">
          Last updated:{" "}
          {new Date(lastUpdated).toLocaleDateString("en-US", {
            month: "short", day: "numeric", year: "numeric",
          })}
        </p>
      )}
      <p className="mt-1 text-xs text-text-muted/70 text-center">
        Data sourced from Limitless TCG · Updated weekly.
      </p>
    </main>
  );
}
