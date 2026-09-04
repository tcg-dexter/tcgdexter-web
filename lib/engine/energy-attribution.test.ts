import { describe, expect, it } from "vitest";
import { normalizePerspective, parseBattleLog } from "@/lib/battle-log";
import { replay } from "./replay";

// Stage 2 of the energy-attribution work: the reducer primitives the solver
// drives — an ambiguity oracle that picks among same-printing duplicates, and
// a discard-shortfall diagnostic that flags an assignment which starves the
// instance that later pays an energy cost.

const TWO_VOLTORB = `Setup
alice chose heads for the opening coin flip.
alice won the coin toss.
alice decided to go first.
alice drew 7 cards for the opening hand.
bob drew 7 cards for the opening hand.
alice played (base_1) Pikachu to the Active Spot.
bob played (base_2) Bulbasaur to the Active Spot.

alice's Turn
alice played (setX_1) Voltorb to the Bench.
alice played (setX_1) Voltorb to the Bench.
alice attached (mee_1) Basic Lightning Energy to (setX_1) Voltorb on the Bench.
alice ended their turn.
`;

describe("energy attribution — ambiguity oracle", () => {
  const parsed = normalizePerspective(parseBattleLog(TWO_VOLTORB), "alice");

  it("defaults to the first candidate with no oracle", () => {
    const bench = replay(parsed).finalState.sides.player.bench;
    expect(bench[0].attachedEnergy.length).toBe(1);
    expect(bench[1].attachedEnergy.length).toBe(0);
  });

  it("routes the attach to the instance the oracle names", () => {
    let candidates: string[] = [];
    const result = replay(parsed, {
      resolveAmbiguous: (info) => {
        if (info.kind === "attach_energy") {
          candidates = info.candidateIds;
          // Deliberately pick the SECOND candidate, not the default first.
          return info.candidateIds[1];
        }
        return undefined;
      },
    });
    expect(candidates.length).toBe(2);
    const chosen = result.finalState.sides.player.bench.find(
      (m) => m.id === candidates[1],
    );
    const other = result.finalState.sides.player.bench.find(
      (m) => m.id === candidates[0],
    );
    expect(chosen?.attachedEnergy.length).toBe(1);
    expect(other?.attachedEnergy.length).toBe(0);
  });
});

// An Active retreats paying an energy it isn't holding — the feasibility
// signal the solver scores. (Here the Active never received the energy.)
const STARVED_RETREAT = `Setup
alice chose heads for the opening coin flip.
alice won the coin toss.
alice decided to go first.
alice drew 7 cards for the opening hand.
bob drew 7 cards for the opening hand.
alice played (base_1) Pikachu to the Active Spot.
bob played (base_2) Bulbasaur to the Active Spot.

alice's Turn
alice played (base_9) Snorlax to the Bench.
alice retreated (base_1) Pikachu to the Bench.
- 1 card was discarded from a11father's (base_1) Pikachu.
   • (mee_1) Basic Lightning Energy
alice's (base_9) Snorlax is now in the Active Spot.
alice ended their turn.
`;

describe("energy attribution — discard shortfall signal", () => {
  it("flags a retreat paying energy the Active never had", () => {
    const parsed = normalizePerspective(parseBattleLog(STARVED_RETREAT), "alice");
    const result = replay(parsed);
    const shortfalls = result.diagnostics.filter(
      (d) => d.code === "energy_discard_shortfall",
    );
    expect(shortfalls.length).toBe(1);
  });
});
