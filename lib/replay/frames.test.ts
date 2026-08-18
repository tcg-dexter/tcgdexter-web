import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildReplayPayload } from "./frames";

const EXAMPLE = readFileSync(
  join(__dirname, "..", "battle-log", "fixtures", "example-1.txt"),
  "utf8",
);

const payload = buildReplayPayload("m1", EXAMPLE, "MoonSheikah");

// A discard-then-draw exchange is a single action in the log — TCG Live
// writes the discard and draw as child lines, not entries — but the viewer
// walks it a beat at a time, so buildReplayPayload expands it into three
// frames. The overlay's behaviour rests entirely on the shape of that
// expansion: it reveals a group per stage, and it stays mounted across the
// three because AnimatePresence is keyed on actionIndex. Break the order,
// the adjacency, or the shared index and the overlay either shows the wrong
// groups or blinks out between beats.
describe("replay frames: discard-then-draw staging", () => {
  const exchangeStarts = payload.frames
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.discardDraw?.stage === "play");

  it("is not a vacuous guard — the fixture contains exchanges", () => {
    expect(exchangeStarts.length).toBeGreaterThan(0);
  });

  it("expands each exchange into play → discard → draw on adjacent frames", () => {
    for (const { i } of exchangeStarts) {
      expect(
        [0, 1, 2].map((k) => payload.frames[i + k]?.discardDraw?.stage),
      ).toEqual(["play", "discard", "draw"]);
    }
  });

  it("gives all three frames of an exchange the same actionIndex", () => {
    // Shared index is what keeps the overlay mounted across the stages, and
    // what keeps the thread spotlighting one post for the whole exchange.
    for (const { i } of exchangeStarts) {
      const indices = [0, 1, 2].map((k) => payload.frames[i + k].actionIndex);
      expect(new Set(indices).size).toBe(1);
    }
  });

  it("carries the same exchange payload on every stage", () => {
    for (const { i } of exchangeStarts) {
      const [a, b, c] = [0, 1, 2].map(
        (k) => payload.frames[i + k].discardDraw!,
      );
      for (const other of [b, c]) {
        expect(other.source).toEqual(a.source);
        expect(other.discarded).toEqual(a.discarded);
        expect(other.drawn).toEqual(a.drawn);
        expect(other.drawnCount).toBe(a.drawnCount);
        expect(other.actor).toBe(a.actor);
      }
    }
  });

  it("only marks frames that both discarded and drew", () => {
    // A bare discard (a retreat cost) or a bare draw (start of turn) is
    // ordinary board state; raising a full-mat overlay for those would bury
    // the board in interruptions.
    for (const frame of payload.frames) {
      if (!frame.discardDraw) continue;
      expect(frame.discardDraw.discarded.length).toBeGreaterThan(0);
      expect(frame.discardDraw.drawnCount).toBeGreaterThan(0);
    }
  });

  it("resolves art for every card it puts on screen", () => {
    const cards = payload.frames
      .filter((f) => f.discardDraw?.stage === "play")
      .flatMap((f) => [
        f.discardDraw!.source,
        ...f.discardDraw!.discarded,
        ...f.discardDraw!.drawn,
      ]);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.filter((c) => !c.imageUrl)).toEqual([]);
  });
});

// The mulligan overlay's row count only ever grows and its cards only ever
// come from a fixed sequence of "mulligan" then "mulligan_total" actions —
// but that sequence can span TWO source actions with a running per-actor
// accumulator threading them together (see buildReplayPayload), which is
// exactly the kind of state that's easy to get right for one player and
// wrong for interleaved cases, or right for row 1 and wrong once a second
// action starts appending to it.
describe("replay frames: mulligan staging", () => {
  // MoonSheikah mulligans 3 times in this fixture: once via a standalone
  // "mulligan" action, then twice more bundled into one "mulligan_total".
  const beats = payload.frames
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.mulligan);

  it("is not a vacuous guard — the fixture contains a multi-mulligan sequence", () => {
    expect(beats.length).toBeGreaterThan(1);
  });

  it("reveals exactly one new row per beat, in order", () => {
    beats.forEach(({ f }, i) => {
      expect(f.mulligan!.rows.length).toBe(i + 1);
    });
  });

  it("carries every earlier row forward unchanged as later rows land", () => {
    const rowNames = (rows: { name: string }[][]) =>
      rows.map((r) => r.map((c) => c.name));
    for (let i = 1; i < beats.length; i++) {
      const prev = rowNames(beats[i - 1].f.mulligan!.rows);
      const cur = rowNames(beats[i].f.mulligan!.rows).slice(0, prev.length);
      expect(cur).toEqual(prev);
    }
  });

  it("reports the same final total row count on every beat", () => {
    const totals = Array.from(new Set(beats.map(({ f }) => f.mulligan!.totalRows)));
    expect(totals.length).toBe(1);
    expect(totals[0]).toBe(beats.length);
  });

  it("clears immediately after the sequence's last beat", () => {
    const lastBeatFrameIndex = beats[beats.length - 1].i;
    expect(payload.frames[lastBeatFrameIndex + 1].mulligan).toBeNull();
  });

  it("each row holds a full opening hand and resolves art for every card", () => {
    const last = beats[beats.length - 1].f.mulligan!;
    for (const row of last.rows) {
      expect(row.length).toBe(7);
      expect(row.filter((c) => !c.imageUrl)).toEqual([]);
    }
  });
});

// The player/opponent hand asymmetry the mulligan and discard/draw work
// above already leans on is worth its own explicit test: TCG Live's export
// only names the exporting account's own drawn cards, so `player_handle`
// isn't just a display label — it decides which side's SideFrame.hand comes
// back as real, image-resolved cards versus CardInstance.unrevealed
// placeholders. example-1.txt's raw text names a11father's cards throughout
// (draws, prize pickups) and anonymises MoonSheikah's, so a11father is this
// fixture's actual "exporting account" regardless of which side other tests
// in this file pick as the perspective.
describe("replay frames: hand visibility follows player_handle", () => {
  const asExporter = buildReplayPayload("m1", EXAMPLE, "a11father");
  const asOtherSide = buildReplayPayload("m1", EXAMPLE, "MoonSheikah");

  it("gives the exporting account's perspective real, resolved hand cards", () => {
    const midGame = asExporter.frames.find(
      (f) => f.player.hand.length > 0 && f.turn > 3,
    );
    expect(midGame).toBeDefined();
    for (const card of midGame!.player.hand) {
      expect(card.revealed).toBe(true);
      expect(card.name).not.toBe("(unrevealed)");
      expect(card.imageUrl).not.toBeNull();
    }
  });

  it("keeps the non-exporting side's hand as unrevealed placeholders", () => {
    const midGame = asExporter.frames.find(
      (f) => f.opponent.hand.length > 0 && f.turn > 3,
    );
    expect(midGame).toBeDefined();
    for (const card of midGame!.opponent.hand) {
      expect(card.revealed).toBe(false);
      expect(card.imageUrl).toBeNull();
    }
  });

  it("flips which side is which when the chosen perspective flips", () => {
    // Same raw log, opposite player_handle — the exporting account
    // (a11father) is now `opponent`, so it should be its hand that's real.
    const midGame = asOtherSide.frames.find(
      (f) => f.opponent.hand.length > 0 && f.turn > 3,
    );
    expect(midGame).toBeDefined();
    expect(midGame!.opponent.hand.every((c) => c.revealed)).toBe(true);
  });

  it("keeps hand count accurate even when contents are hidden", () => {
    // handCount has to stay trustworthy on its own — the UI's other hand
    // affordances (deck/hand tallies elsewhere on the mat) read it
    // independent of whether the strip can show real art for it.
    for (const f of asExporter.frames) {
      expect(f.opponent.handCount).toBe(f.opponent.hand.length);
      expect(f.player.handCount).toBe(f.player.hand.length);
    }
  });
});

// The card inspector's attached-cards row reads PokemonFrame.attachedCards
// directly, so it has to agree with the energy names the board's own
// footer already shows (PokemonFrame.energy) and resolve art for each —
// unlike energy, which frames.ts already exposed as bare names with no
// image, attachedCards is new and is the row's only data source.
describe("replay frames: attached cards", () => {
  const asExporter = buildReplayPayload("m1", EXAMPLE, "a11father");

  it("is not a vacuous guard — some in-play Pokémon has energy attached", () => {
    const hasAttached = asExporter.frames.some((f) =>
      [f.player.active, ...f.player.bench, f.opponent.active, ...f.opponent.bench].some(
        (mon) => mon && mon.attachedCards.length > 0,
      ),
    );
    expect(hasAttached).toBe(true);
  });

  it("matches energy's own names, in order, each resolved to art", () => {
    for (const f of asExporter.frames) {
      for (const mon of [
        f.player.active,
        ...f.player.bench,
        f.opponent.active,
        ...f.opponent.bench,
      ]) {
        if (!mon) continue;
        // attachedCards is energy-then-tools; this fixture's Pokémon carry
        // no tools, so it should equal `energy` name-for-name here.
        const energyPortion = mon.attachedCards.slice(0, mon.energy.length);
        expect(energyPortion.map((c) => c.name)).toEqual(mon.energy);
        for (const c of mon.attachedCards) expect(c.imageUrl).not.toBeNull();
      }
    }
  });
});
