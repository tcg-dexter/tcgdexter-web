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

/**
 * Trainer-card reprint exception.
 *
 * Official Pokémon TCG rule: a Trainer card's legality follows its
 * name/effect, not the specific printing — once reprinted under a
 * current regulation mark, every earlier printing (even a rotated-mark
 * copy) is legal too. Pokémon and Energy cards do NOT get this
 * exception; their legality is strictly per-printing.
 *
 * Boss's Orders printings (data/cards-standard.json):
 *   RCL (swsh2) #189 → mark "D" → rotated on its own
 *   MEG (me1)   #114 → mark "I" → current — legalizes every printing
 */
describe("repriceDeck — Trainer cards with a legal reprint are exempt from rotation", () => {
  it("treats RCL Boss's Orders (mark D) as legal because a current MEG reprint exists", () => {
    const deck = "Trainer: 1\n2 Boss's Orders RCL 189\n";
    const { rotation } = repriceDeck(deck);
    expect(rotation.ready).toBe(true);
    expect(rotation.rotatingCount).toBe(0);
  });

  it("still flags a Trainer card with no current-mark reprint (Great Ball, mark G)", () => {
    // Every Great Ball printing is either mark-less (old, pre-mark era —
    // legal by the same "unmarked defaults to legal" rule Dunsparce's
    // first-printing test exercises) or a rotated mark (D/F/G) — none
    // carry a current mark, so the reprint exception should not apply.
    // Pin the exact rotated printing via set code + number so
    // pickPrintingForCard doesn't resolve to one of the unmarked ones.
    const deck = "Trainer: 1\n4 Great Ball PAL 183\n";
    const { rotation } = repriceDeck(deck);
    expect(rotation.ready).toBe(false);
    expect(rotation.rotatingCards).toContainEqual({ name: "Great Ball", qty: 4 });
  });

  it("does not extend the reprint exception to Pokémon cards", () => {
    // PAL Dunsparce (mark G) has no bearing here — Dunsparce is a Pokémon,
    // so a same-name reprint under a current mark (if any existed) would
    // still not legalize this specific printing.
    const deck = "Pokémon: 1\n1 Dunsparce PAL 156\n";
    const { rotation } = repriceDeck(deck);
    expect(rotation.ready).toBe(false);
  });
});
