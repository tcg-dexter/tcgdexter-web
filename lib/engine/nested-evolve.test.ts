import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizePerspective, parseBattleLog } from "@/lib/battle-log";
import { replay } from "./replay";

// Real match ChallengedLazer vs SirDiguinho. Rare Candy and Grand Tree don't
// state their evolutions at the top level — the log nests them under the
// trainer's own play line:
//
//   SirDiguinho played Grand Tree.
//   - SirDiguinho evolved Froakie to Frogadier on the Bench.
//   - SirDiguinho evolved Frogadier to Greninja ex on the Bench.
//
// extractChildActions didn't recognize that wording, so every such evolution
// was dropped. The base Pokémon was never consumed and the evolution never
// entered play, which compounded three ways: the same Froakie could be
// "evolved" twice over, "SirDiguinho's Dusknoir was Knocked Out!" found no
// Dusknoir to remove and left the KO'd line on the board, and SirDiguinho's
// bench grew to 8 — past the 5-card cap the game enforces.
const LOG = readFileSync(
  join(__dirname, "fixtures", "challengedlazer-sirdiguinho.txt"),
  "utf8",
);

const parsed = normalizePerspective(parseBattleLog(LOG), "ChallengedLazer");
const res = replay(parsed, { keepSnapshots: true });

describe("evolutions nested under a trainer card are parsed and applied", () => {
  it("parses the nested Rare Candy / Grand Tree evolutions, not just top-level ones", () => {
    const evolves = parsed.actions.filter((a) => a.action_type === "evolve");
    // 4 top-level + 7 nested under a trainer play.
    expect(evolves).toHaveLength(11);

    const nested = evolves.filter((a) => a.raw_text.trimStart().startsWith("-"));
    expect(nested).toHaveLength(7);

    // The Rare Candy line specifically — Duskull → Dusknoir on the Bench.
    expect(
      nested.some(
        (a) =>
          a.payload.from === "Duskull" &&
          a.payload.to === "Dusknoir" &&
          a.payload.location === "bench",
      ),
    ).toBe(true);
  });

  it("never lets either bench exceed the 5-Pokémon cap", () => {
    for (const state of res.states) {
      expect(state.sides.player.bench.length).toBeLessThanOrEqual(5);
      expect(state.sides.opponent.bench.length).toBeLessThanOrEqual(5);
    }
  });

  it("leaves SirDiguinho the board the log actually describes at the end", () => {
    const bench = res.finalState.sides.opponent.bench.map((b) => b.card.name);
    expect([...bench].sort()).toEqual(
      ["Duskull", "Fezandipiti ex", "Froakie", "Greninja ex", "Meowth ex"].sort(),
    );
    // Latias ex took the game-ending KO out of the Active Spot.
    expect(res.finalState.sides.opponent.active).toBeNull();
  });

  it("consumes each evolving base rather than leaving it in play", () => {
    const inPlay = [
      res.finalState.sides.opponent.active,
      ...res.finalState.sides.opponent.bench,
    ].filter((m): m is NonNullable<typeof m> => m != null);

    // Three Froakie were played across the match and two were evolved away,
    // so exactly one may remain. The bug left all three sitting on the bench.
    expect(inPlay.filter((m) => m.card.name === "Froakie")).toHaveLength(1);
    // The first Duskull became Dusknoir and was KO'd; only the Night
    // Stretcher copy replayed on the last turn is still out.
    expect(inPlay.filter((m) => m.card.name === "Duskull")).toHaveLength(1);
  });
});
