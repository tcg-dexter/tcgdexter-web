import CardImage from "@/app/cards/CardImage";
import DeckTileFooter from "@/app/components/DeckTileFooter";
import { cardImageSmall } from "@/lib/cardImages";
import { getAllCards, type CardIndexEntry } from "@/lib/cardsIndex";

interface AnalysisCard {
  qty: number;
  name: string;
  number: string;
  setCode: string;
  section: "pokemon" | "trainer" | "energy";
}

const SECTION_ORDER: Record<AnalysisCard["section"], number> = {
  pokemon: 0,
  trainer: 1,
  energy: 2,
};

interface Tile {
  name: string;
  copyCount: number;
  section: AnalysisCard["section"];
  fallbackSetCode: string;
  fallbackNumber: string;
  entry: CardIndexEntry | null;
}

function resolveEntry(
  byNameIndex: Map<string, CardIndexEntry[]>,
  card: Pick<AnalysisCard, "name" | "number" | "setCode">,
): CardIndexEntry | null {
  const candidates = byNameIndex.get(card.name.toLowerCase());
  if (!candidates?.length) return null;
  return (
    candidates.find(
      (c) => c.ptcgoCode === card.setCode && c.number === card.number,
    ) ??
    candidates.find((c) => c.number === card.number) ??
    candidates[0]
  );
}

/**
 * Renders a deck's contents as a responsive grid of card images, one tile
 * per unique card name. Footer overlay shows set/number plus copy count.
 *
 * Tiles with no resolvable image fall back to `CardImage`'s built-in
 * "no image" placeholder, keeping the footer count visible. Multiple
 * printings of the same name are folded into a single tile with the
 * summed copy count and the first printing's image.
 *
 * Mirrors the visual treatment of `app/cards` (`GridTile` + the gradient
 * `CardFooterOverlay`) so deck profiles feel of a piece with the catalog.
 */
export default function DeckCardGrid({ cards }: { cards: AnalysisCard[] }) {
  // Group by normalized name; sum copy counts across printings.
  const grouped = new Map<string, Tile>();
  for (const c of cards) {
    const key = c.name.trim().toLowerCase();
    const existing = grouped.get(key);
    if (existing) {
      existing.copyCount += c.qty;
    } else {
      grouped.set(key, {
        name: c.name,
        copyCount: c.qty,
        section: c.section,
        fallbackSetCode: c.setCode,
        fallbackNumber: c.number,
        entry: null,
      });
    }
  }

  // Resolve each tile to its CardIndexEntry for image + set metadata.
  // Build a name→entries map once so we don't scan the full index per tile.
  const byNameIndex = new Map<string, CardIndexEntry[]>();
  for (const c of getAllCards()) {
    const arr = byNameIndex.get(c.nameLower);
    if (arr) arr.push(c);
    else byNameIndex.set(c.nameLower, [c]);
  }
  const tiles = Array.from(grouped.values()).map((tile) => {
    tile.entry = resolveEntry(byNameIndex, {
      name: tile.name,
      number: tile.fallbackNumber,
      setCode: tile.fallbackSetCode,
    });
    return tile;
  });
  tiles.sort((a, b) => {
    const so = SECTION_ORDER[a.section] - SECTION_ORDER[b.section];
    if (so) return so;
    if (b.copyCount !== a.copyCount) return b.copyCount - a.copyCount;
    return a.name.localeCompare(b.name);
  });

  if (tiles.length === 0) return null;

  return (
    <div
      className="grid grid-cols-3 md:grid-cols-6 gap-3"
      aria-label="Deck cards"
    >
      {tiles.map((t) => {
        const entry = t.entry;
        const setId = entry?.setId ?? "";
        const number = entry?.number ?? t.fallbackNumber;
        const setName = entry?.setName ?? "";
        const src = setId ? cardImageSmall(setId, number) : "";
        const alt = setName
          ? `${t.name} — ${setName} ${number}`
          : `${t.name} ${number}`;
        return (
          <div
            key={`${t.section}:${t.name.toLowerCase()}`}
            className="relative w-full rounded-xl overflow-hidden bg-surface"
            style={{ aspectRatio: "245 / 342" }}
          >
            <CardImage
              src={src}
              alt={alt}
              name={t.name}
              setName={setName}
              number={number}
              className="w-full h-full object-contain"
            />
            <DeckTileFooter copyCount={t.copyCount} />
          </div>
        );
      })}
    </div>
  );
}
