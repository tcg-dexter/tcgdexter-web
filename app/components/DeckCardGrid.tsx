import DeckCardGridClient from "@/app/components/DeckCardGridClient";
import { resolveDeckTiles, type DeckTileCard } from "@/lib/deckTiles";

/**
 * Renders a deck's contents as a responsive grid of card images, one tile
 * per unique card name. Footer overlay shows set/number plus copy count.
 *
 * Mirrors the visual treatment of `app/cards` (`GridTile` + the gradient
 * `CardFooterOverlay`) so deck profiles feel of a piece with the catalog.
 *
 * Resolution / ordering logic lives in `lib/deckTiles.ts` so it can be
 * reused by the admin-tools "deck mat" view, which renders the same
 * resolved tiles as fanned card piles instead of single-image tiles.
 */
export default function DeckCardGrid({ cards }: { cards: DeckTileCard[] }) {
  const resolved = resolveDeckTiles(cards);
  if (resolved.length === 0) return null;
  return <DeckCardGridClient tiles={resolved} />;
}
