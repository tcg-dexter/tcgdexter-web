/**
 * reprice-deck.ts — Re-calculate deck price and rotation status from the
 * latest bundled card data.
 *
 * Used by shared deck pages (/d/[shortId]) and saved deck pages to ensure
 * prices and rotation reflect current data rather than a frozen snapshot.
 *
 * Printing resolution (set code + collector number) is delegated to
 * @/lib/cardPrinting so this path matches /api/analyze exactly. Previously
 * this file parsed name-only and used the first DB printing, which could
 * flag a legal card (e.g. JTG Dunsparce, mark "I") as "not legal".
 */

import { parseDeckListCards, pickPrintingForCard } from "@/lib/cardPrinting";

const ROTATING_MARKS = new Set(["A", "B", "C", "D", "E", "F", "G"]);

export interface RepriceResult {
  deckPrice: number;
  rotation: {
    ready: boolean;
    rotatingCount: number;
    rotatingCards: Array<{ name: string; qty: number }>;
  };
}

/**
 * Re-price a deck list using the latest bundled card data.
 * Returns updated deckPrice and rotation status.
 */
export function repriceDeck(deckList: string): RepriceResult {
  const cards = parseDeckListCards(deckList);

  let totalPrice = 0;
  const rotatingCards: Array<{ name: string; qty: number }> = [];

  for (const card of cards) {
    // Resolve the exact printing the deck list names (set code + number),
    // not just the first printing of this card.
    const entry = pickPrintingForCard(card);
    if (!entry) continue;

    if (entry.market_price !== null && entry.market_price > 0) {
      totalPrice += entry.market_price * card.qty;
    }

    const mark = entry.regulation_mark;
    if (mark && ROTATING_MARKS.has(mark.toUpperCase())) {
      rotatingCards.push({ name: card.name, qty: card.qty });
    }
  }

  const rotatingCount = rotatingCards.reduce((s, c) => s + c.qty, 0);

  return {
    deckPrice: Math.round(totalPrice * 100) / 100,
    rotation: {
      ready: rotatingCount === 0,
      rotatingCount,
      rotatingCards,
    },
  };
}
