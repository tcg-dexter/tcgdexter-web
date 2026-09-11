import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizePerspective } from "@/lib/battle-log";
import { buildReplayPayload } from "@/lib/replay/frames";
import { parseBattleLogWithCatalog } from "./parseWithCatalog";

// Real match yourkoreandad vs papaolafar (battle Ap3s-fqZ). TCG Live writes a
// trainer that shuffles cards out of hand as ONE block with the movement on a
// child line:
//
//   yourkoreandad played Lillie's Determination.
//   - yourkoreandad shuffled 2 cards into their deck.
//      • Unfair Stamp, Boss's Orders
//   - yourkoreandad drew 8 cards.
//      • ...
//
// A standalone top-level "shuffled N cards into their deck." line already
// became its own `shuffle` action, which the reducer applies. Nested like this
// it had no home: the bullet names were swept into `revealed_cards` and the
// cards were never taken out of hand. They lingered as ghosts, so when the
// player legitimately redrew Unfair Stamp later the board showed TWO copies --
// illegal for a one-per-deck ACE SPEC, and wrong about card identity besides.
const LOG = readFileSync(
  join(__dirname, "fixtures", "yourkoreandad-papaolafar.txt"),
  "utf8",
);

const parsed = normalizePerspective(parseBattleLogWithCatalog(LOG), "yourkoreandad");
const payload = buildReplayPayload("test", LOG, "yourkoreandad");

/** Highest number of copies of `name` held in the player's hand at once. */
function peakInHand(name: string): number {
  return Math.max(
    ...payload.frames.map(
      (f) => f.player.hand.filter((c) => c.name === name).length,
    ),
  );
}

describe("cards shuffled from hand into the deck leave the hand", () => {
  it("captures the nested shuffle-into-deck names the block used to drop", () => {
    const lillie = parsed.actions.find(
      (a) =>
        a.actor === "player" &&
        (a.payload as Record<string, unknown>).card === "Lillie's Determination",
    );
    const p = (lillie?.payload ?? {}) as Record<string, unknown>;
    expect(p.shuffled_into_deck).toEqual(["Unfair Stamp", "Boss's Orders"]);
    // The log's own count, kept alongside the names it could give us.
    expect(p.shuffled_into_deck_count).toBe(2);
  });

  it("never shows two Unfair Stamps in hand at once", () => {
    // The reported symptom. One copy is legal; two is not a board that can
    // exist, ACE SPEC being one-per-deck.
    expect(peakInHand("Unfair Stamp")).toBe(1);
  });

  it("keeps that one card's whole life coherent, not just its peak", () => {
    // Opening hand -> shuffled away -> redrawn -> shuffled away again.
    // Collapsing consecutive duplicates gives the transitions in order.
    const series = payload.frames.map(
      (f) => f.player.hand.filter((c) => c.name === "Unfair Stamp").length,
    );
    const transitions = series.filter((n, i) => i === 0 || n !== series[i - 1]);
    expect(transitions).toEqual([0, 1, 0, 1, 0]);
  });

  it("holds for every card in the battle, not only the ACE SPEC", () => {
    // A ghost left in hand by this bug would show as some card exceeding the
    // 4-copy deck-building limit. Basic Energy is exempt (no limit), and
    // unrevealed placeholders all share one name, so both are excluded.
    for (const frame of payload.frames) {
      const counts = new Map<string, number>();
      for (const c of frame.player.hand) {
        if (c.name === "(unrevealed)" || /^Basic .* Energy$/.test(c.name)) continue;
        counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
      }
      counts.forEach((n, name) => {
        expect(n, `${name} x${n} in hand: ${frame.summary}`).toBeLessThanOrEqual(4);
      });
    }
  });

  it("leaves the opponent's hidden hand alone", () => {
    // Their shuffle lines are counted but unnamed, so there is nothing to
    // remove by name — and nothing to remove by count either, since nested
    // draws aren't modelled and the hand would only drain. Asserted so a
    // future change to that trade-off has to be deliberate.
    const oppLillie = parsed.actions.find(
      (a) =>
        a.actor === "opponent" &&
        (a.payload as Record<string, unknown>).card === "Lillie's Determination",
    );
    const p = (oppLillie?.payload ?? {}) as Record<string, unknown>;
    expect(p.shuffled_into_deck).toEqual([]);
    expect(p.shuffled_into_deck_count).toBeGreaterThan(0);
  });
});
