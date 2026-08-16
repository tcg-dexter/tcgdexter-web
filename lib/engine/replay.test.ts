import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizePerspective, parseBattleLog } from "@/lib/battle-log";
import { replay } from "./replay";

const EXAMPLE = readFileSync(
  join(__dirname, "..", "battle-log", "fixtures", "example-1.txt"),
  "utf8",
);

describe("engine.replay (example-1)", () => {
  // Player = MoonSheikah, opponent = a11father (who wins the game).
  const parsed = normalizePerspective(parseBattleLog(EXAMPLE), "MoonSheikah");
  const result = replay(parsed);

  it("emits exactly one event per parsed action", () => {
    expect(result.events.length).toBe(parsed.actions.length);
  });

  it("ends with the prize-out victory recorded against the opponent", () => {
    expect(result.finalState.endReason).toBe("prizes");
    expect(result.finalState.winner).toBe("opponent");
  });

  it("tallies the prize counts both sides ended with", () => {
    // a11father took: 1 (Staryu) + 3 (Mega Greninja ex, multi-prize boost)
    //                + 2 (Budew & Froakie double-KO) = 6 prizes.
    expect(result.finalState.prizesTaken.opponent).toBe(6);
    // MoonSheikah took 2 prizes (a11father's N's Zoroark ex was an ex KO).
    expect(result.finalState.prizesTaken.player).toBe(2);
  });

  it("empties the opponent's prize stack since they prized out", () => {
    expect(result.finalState.sides.opponent.prizes.length).toBe(0);
  });

  it("places knocked-out Pokémon into the right side's discard pile", () => {
    // The engine reflects what the parser surfaces. Buddy-Buddy Poffin's
    // search-and-bench effect is one example — see the parser-gap follow-up.
    // "drew 2 cards and played them to the Bench" line is not yet split
    // into individual play_to_bench actions, so cards added that way
    // (Staryu, Froakie, the eventual Mega Greninja ex line) never enter
    // the engine's bench and can't be tracked through to KO. The engine
    // surfaces this gap via "evolve_source_missing" / "switch_target_missing"
    // diagnostics; the assertions below cover only directly-played Pokémon.
    const playerDiscardNames = result.finalState.sides.player.discard.map((c) => c.name);
    expect(playerDiscardNames).toContain("Budew");

    const oppDiscardNames = result.finalState.sides.opponent.discard.map((c) => c.name);
    expect(oppDiscardNames).toContain("N's Zoroark ex");
  });

  it("flags parser gaps via warn-level diagnostics rather than silently dropping state", () => {
    const codes = new Set(result.diagnostics.map((d) => d.code));
    // The Buddy-Buddy Poffin path means Froakie never reaches the bench,
    // so the later "evolved Froakie to Frogadier" raises this code.
    expect(codes.has("evolve_source_missing")).toBe(true);
  });

  it("tracks the active stadium card and its owner", () => {
    // The last stadium played was Surfing Beach by MoonSheikah; it should
    // still be in play when the game ends.
    expect(result.finalState.stadium?.card.name).toBe("Surfing Beach");
    expect(result.finalState.stadium?.owner).toBe("player");
  });

  it("identifies the first player from the chose_first event", () => {
    expect(result.finalState.firstPlayer).toBe("player");
  });

  it("records mulligan totals on the right side", () => {
    expect(result.finalState.sides.player.mulligans).toBe(3);
    expect(result.finalState.sides.opponent.mulligans).toBe(0);
  });

  it("produces no error-severity diagnostics for this clean replay", () => {
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toEqual([]);
  });

  // The Replay board keys React elements and framer-motion layoutIds off
  // each Pokémon's engine id. Names are NOT unique — this fixture puts three
  // N's Zorua in play at once — so if two in-play Pokémon on a side ever
  // shared an id, the board would key them identically and framer-motion
  // would animate unrelated cards into each other's slots, stranding ghost
  // cards outside the bench row (the phantom "6th bench card" bug).
  describe("in-play Pokémon ids (the board's element identity)", () => {
    const inPlayOn = (state: (typeof result.states)[number], side: "player" | "opponent") => {
      const s = state.sides[side];
      return [...(s.active ? [s.active] : []), ...s.bench];
    };

    it("stay unique per side in every state of the replay", () => {
      for (const state of result.states) {
        for (const side of ["player", "opponent"] as const) {
          const ids = inPlayOn(state, side).map((mon) => mon.id);
          expect(new Set(ids).size).toBe(ids.length);
        }
      }
    });

    it("is not a vacuous guard — this replay really does field same-named Pokémon together", () => {
      const maxSameName = result.states.reduce((max, state) => {
        for (const side of ["player", "opponent"] as const) {
          const counts = new Map<string, number>();
          for (const mon of inPlayOn(state, side)) {
            const n = (counts.get(mon.card.name) ?? 0) + 1;
            counts.set(mon.card.name, n);
            if (n > max) max = n;
          }
        }
        return max;
      }, 0);
      expect(maxSameName).toBeGreaterThanOrEqual(2);
    });
  });
});
