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
