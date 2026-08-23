import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDeckBattleCards } from "./recent-battles";

const DECK = { id: "deck-1", name: "Dragapult ex", user_id: "user-1" };

/**
 * A Supabase client whose every query resolves to no rows.
 *
 * loadDeckBattleCards is handed its battle rows directly; the client is only
 * used for the enrichment reads (deck art, attack/play/prize actions). Those
 * returning nothing is the honest shape of a freshly logged manual battle,
 * and it leaves the date/order behaviour under test as the only thing that
 * can move the assertions.
 */
function emptySupabase(): SupabaseClient {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "in", "eq", "order", "range"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (value: { data: unknown[] }) => unknown) =>
    resolve({ data: [] });
  return { from: () => chain } as unknown as SupabaseClient;
}

function row(id: string, playedAt: string | null, createdAt: string) {
  return {
    id,
    short_id: id,
    result: "win",
    opponent_archetype: null,
    opponent_handle: null,
    created_at: createdAt,
    played_at: playedAt,
    saved_deck_id: DECK.id,
    source: "manual",
    prizes_taken_player: null,
    prizes_taken_opponent: null,
    game_prizes: null,
    game_results: null,
  };
}

function load(rows: ReturnType<typeof row>[]) {
  return loadDeckBattleCards(emptySupabase(), rows, DECK, "dexter");
}

// A deck's own history is a diary of games played, not a feed of rows
// written — so unlike /battles it dates and orders by played_at. A battle
// logged three days late belongs where it was played, not at the top.
describe("loadDeckBattleCards", () => {
  it("dates a card by when the battle was played, not when it was logged", async () => {
    const [card] = await load([
      row("a", "2026-08-01T12:00:00Z", "2026-08-04T09:00:00Z"),
    ]);
    expect(card.createdAt).toBe("2026-08-01T12:00:00Z");
  });

  it("orders newest-played first, whatever order the rows arrive in", async () => {
    const cards = await load([
      row("mid", "2026-08-10T00:00:00Z", "2026-08-10T00:00:00Z"),
      row("newest", "2026-08-20T00:00:00Z", "2026-08-20T00:00:00Z"),
      row("oldest", "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z"),
    ]);
    expect(cards.map((c) => c.id)).toEqual(["newest", "mid", "oldest"]);
  });

  it("falls back to created_at for a battle with no played_at", async () => {
    // played_at is nullable, and the caller's ORDER BY puts those nulls
    // first — so this row would lead the rail if the fallback date didn't
    // also drive the sort.
    const cards = await load([
      row("undated", null, "2026-08-05T00:00:00Z"),
      row("newer", "2026-08-12T00:00:00Z", "2026-08-12T00:00:00Z"),
      row("older", "2026-08-02T00:00:00Z", "2026-08-02T00:00:00Z"),
    ]);
    expect(cards.map((c) => c.id)).toEqual(["newer", "undated", "older"]);
    expect(cards.find((c) => c.id === "undated")?.createdAt).toBe(
      "2026-08-05T00:00:00Z",
    );
  });

  it("keeps a battle whose opponent can't be named", async () => {
    // The public feed drops these to stay visually rich; a deck's own
    // history must not hide the owner's real games. BattleCard falls back
    // to its simple layout for them.
    const cards = await load([row("a", "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z")]);
    expect(cards).toHaveLength(1);
    expect(cards[0].opponentImageUrl).toBeNull();
  });

  it("returns nothing for a deck with no battles without touching the client", async () => {
    const exploding = {
      from: () => {
        throw new Error("should not query");
      },
    } as unknown as SupabaseClient;
    await expect(loadDeckBattleCards(exploding, [], DECK, "dexter")).resolves.toEqual(
      [],
    );
  });
});
