import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildBeats } from "@/lib/replay2/beats";
import { drawFlightFor } from "./fxBus";

function beatsOf(name: string, handle: string) {
  return buildBeats(
    readFileSync(join(process.cwd(), "lib", "battle-log", "fixtures", name), "utf8"),
    handle,
  );
}

const FIXTURES: { name: string; handle: string }[] = [
  { name: "example-1.txt", handle: "MoonSheikah" },
  { name: "example-2-verbose.txt", handle: "a11father" },
  { name: "example-3-same-name-attach.txt", handle: "Nnova12" },
];

describe("which beats send a card out of a pile", () => {
  it("flies opening hands, turn draws, and prize takes", () => {
    for (const { name, handle } of FIXTURES) {
      const beats = beatsOf(name, handle);
      const flights = beats.filter((b) => drawFlightFor(b) != null);
      const drivers = beats.filter(
        (b) =>
          b.kind === "draw" ||
          b.kind === "opening_hand" ||
          b.kind === "prize_taken",
      );
      expect(flights.length, `${name}`).toBe(drivers.length);
      expect(flights.length).toBeGreaterThan(0);
    }
  });

  it("never flies a draw that is part of an exchange", () => {
    // A Trade or an Ultra Ball folds its draw into the parent action, so it
    // reaches the board as an `ability` / `play_trainer` beat with its own
    // discard-then-draw overlay. Animating those here would show the same
    // cards twice, in two different ways, at the same time.
    for (const { name, handle } of FIXTURES) {
      for (const beat of beatsOf(name, handle)) {
        if (beat.kind === "ability" || beat.kind === "play_trainer") {
          expect(drawFlightFor(beat), `${name}: ${beat.kind}`).toBeNull();
        }
      }
    }
  });

  it("turns a card face-up exactly when the log named it", () => {
    // Deliberately not "the player's draws are named". The log names the
    // draws of whoever exported it, and that account is not always the side
    // the payload is normalized to — in example-1 it is the opponent whose
    // draws carry card names. Anything keyed off the side rather than off the
    // naming shows the wrong half of the game face-down.
    let named = 0;
    let unnamed = 0;
    for (const { name, handle } of FIXTURES) {
      for (const beat of beatsOf(name, handle)) {
        if (beat.kind !== "draw") continue;
        const revealed = drawFlightFor(beat)?.revealed;
        expect(revealed, `${name}: ${beat.summary}`).toBe(beat.cards.length > 0);
        if (beat.cards.length > 0) named++;
        else unnamed++;
      }
    }
    // Both halves of the rule are exercised by real logs.
    expect(named).toBeGreaterThan(0);
    expect(unnamed).toBeGreaterThan(0);
  });

  it("carries a sane count for every flight", () => {
    for (const { name, handle } of FIXTURES) {
      for (const beat of beatsOf(name, handle)) {
        const flight = drawFlightFor(beat);
        if (!flight) continue;
        expect(flight.count, `${name}: ${beat.kind}`).toBeGreaterThanOrEqual(1);
        expect(flight.count).toBeLessThanOrEqual(12);
      }
    }
  });
});
