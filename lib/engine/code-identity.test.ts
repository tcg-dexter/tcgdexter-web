import { describe, expect, it } from "vitest";
import { normalizePerspective, parseBattleLog } from "@/lib/battle-log";
import { replay } from "./replay";

// Two same-named Pokémon of DIFFERENT printings on the same bench. The verbose
// export tags each reference with a printing id ("(setB_20) Voltorb"), so an
// attach that names one printing must land on that instance — not the first
// same-named match, which is what the name-only resolver did.
const LOG = `Setup
alice chose heads for the opening coin flip.
alice won the coin toss.
alice decided to go first.
alice drew 7 cards for the opening hand.
bob drew 7 cards for the opening hand.
alice played (base_1) Pikachu to the Active Spot.
bob played (base_2) Bulbasaur to the Active Spot.

alice's Turn
alice played (setA_10) Voltorb to the Bench.
alice played (setB_20) Voltorb to the Bench.
alice attached (mee_1) Basic Lightning Energy to (setB_20) Voltorb on the Bench.
alice ended their turn.
`;

describe("engine.replay — printing-id disambiguation", () => {
  const parsed = normalizePerspective(parseBattleLog(LOG), "alice");
  const result = replay(parsed);
  const bench = result.finalState.sides.player.bench;

  it("keeps two same-named benched Pokémon as distinct instances", () => {
    const voltorbs = bench.filter((m) => m.card.name === "Voltorb");
    expect(voltorbs.length).toBe(2);
  });

  it("carries each benched Pokémon's printing id through play", () => {
    const ids = bench
      .filter((m) => m.card.name === "Voltorb")
      .map((m) => m.card.printingId)
      .sort();
    expect(ids).toEqual(["setA_10", "setB_20"]);
  });

  it("attaches to the printing the log named, not the first same-named match", () => {
    const setB = bench.find((m) => m.card.printingId === "setB_20");
    const setA = bench.find((m) => m.card.printingId === "setA_10");
    expect(setB?.attachedEnergy.length).toBe(1);
    expect(setA?.attachedEnergy.length).toBe(0);
  });
});
