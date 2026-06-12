import { NextResponse } from "next/server";
import { getAllCards, type CardIndexEntry } from "@/lib/cardsIndex";
import { normalizeForSearch } from "@/lib/searchNormalize";
import { cardImageSmall } from "@/lib/cardImages";

const RESULT_LIMIT = 8;

/**
 * GET /api/cards/search?q=pikachu
 *
 * Lightweight name typeahead over the card catalog — ranks exact name
 * matches above prefixes, token-prefixes, then substrings, breaking ties
 * by newest set first. Used by card-picker autocompletes (e.g. spotlight
 * admin "favorite card" fields) where the full /cards browse/filter
 * surface (lib/cardSearch.searchCards) would be overkill.
 */
export function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = normalizeForSearch((searchParams.get("q") ?? "").trim());
  if (!q) return NextResponse.json({ cards: [] });

  const hits: { card: CardIndexEntry; rank: number }[] = [];
  for (const card of getAllCards()) {
    let rank: number;
    if (card.nameLower === q) rank = 0;
    else if (card.nameLower.startsWith(q)) rank = 1;
    else if (card.nameTokens.some((t) => t.startsWith(q))) rank = 2;
    else if (card.nameLower.includes(q)) rank = 3;
    else continue;
    hits.push({ card, rank });
  }
  hits.sort(
    (a, b) =>
      a.rank - b.rank ||
      b.card.setReleaseDate.localeCompare(a.card.setReleaseDate) ||
      a.card.name.localeCompare(b.card.name)
  );

  return NextResponse.json({
    cards: hits.slice(0, RESULT_LIMIT).map(({ card }) => ({
      name: card.name,
      set_id: card.setId,
      set_name: card.setName,
      number: card.number,
      image_url: cardImageSmall(card.setId, card.number),
    })),
  });
}
