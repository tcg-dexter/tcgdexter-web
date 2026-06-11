import { describe, it, expect } from "vitest";
import { repriceDeck } from "./reprice-deck";

/**
 * Regression coverage for the "JTG Dunsparce is not legal" report.
 *
 * The bug: repriceDeck used to judge rotation off the first DB printing of a
 * card (entries[0]), ignoring the set code + number in the deck line. It now
 * resolves the exact printing via @/lib/cardPrinting, so legality matches the
 * card actually in the deck.
 *
 * Dunsparce printings (data/cards-standard.json):
 *   JTG (sv9)  #120 → mark "I"  → legal
 *   PAL (sv2)  #156 → mark "G"  → rotating
 */
describe("repriceDeck — rotation resolves the deck's actual printing", () => {
  it("treats JTG Dunsparce (mark I) as legal", () => {
    const deck = "Pokémon: 1\n1 Dunsparce JTG 120\n";
    const { rotation } = repriceDeck(deck);
    expect(rotation.ready).toBe(true);
    expect(rotation.rotatingCount).toBe(0);
  });

  it("flags PAL Dunsparce (mark G) as rotating", () => {
    const deck = "Pokémon: 1\n1 Dunsparce PAL 156\n";
    const { rotation } = repriceDeck(deck);
    expect(rotation.ready).toBe(false);
    expect(rotation.rotatingCards).toContainEqual({ name: "Dunsparce", qty: 1 });
  });

  it("does not flag JTG Dunsparce even when an older printing is listed first in the DB", () => {
    // The first Dunsparce printing in the DB is mark-less (legal by default);
    // the point is that we pick by set code + number, not by DB order.
    const deck = "Pokémon: 2\n2 Dunsparce JTG 120\n";
    const { rotation } = repriceDeck(deck);
    expect(rotation.rotatingCards).toHaveLength(0);
  });
});
