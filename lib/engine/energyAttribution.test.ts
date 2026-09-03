import { describe, expect, it } from "vitest";
import { normalizePerspective, parseBattleLog } from "@/lib/battle-log";
import { replay } from "./replay";
import { solveEnergyAttribution } from "./energyAttribution";

function shortfalls(parsed: ReturnType<typeof normalizePerspective>, oracle?: ReturnType<typeof solveEnergyAttribution>) {
  const res = replay(parsed, oracle ? { resolveAmbiguous: oracle } : {});
  return res.diagnostics.filter((d) => d.code === "energy_discard_shortfall").length;
}

const SETUP = `Setup
alice chose heads for the opening coin flip.
alice won the coin toss.
alice decided to go first.
alice drew 7 cards for the opening hand.
bob drew 7 cards for the opening hand.
alice played (base_1) Pikachu to the Active Spot.
bob played (base_2) Bulbasaur to the Active Spot.
`;

// No downstream constraint: any attribution is feasible, so the solver just
// returns a valid oracle and the energy lands on exactly one duplicate.
const UNCONSTRAINED = `${SETUP}
alice's Turn
alice played (setX_1) Voltorb to the Bench.
alice played (setX_1) Voltorb to the Bench.
alice attached (mee_1) Basic Lightning Energy to (setX_1) Voltorb on the Bench.
alice ended their turn.
`;

describe("solveEnergyAttribution — unconstrained", () => {
  const parsed = normalizePerspective(parseBattleLog(UNCONSTRAINED), "alice");
  it("returns a usable oracle with no constraint violations", () => {
    const oracle = solveEnergyAttribution(parsed);
    expect(shortfalls(parsed, oracle)).toBe(0);
    const bench = replay(parsed, { resolveAmbiguous: oracle }).finalState.sides
      .player.bench;
    const total = bench.reduce((n, m) => n + m.attachedEnergy.length, 0);
    expect(total).toBe(1);
  });
});

// A later retreat names the discarded energy off the (unambiguous) Active. The
// bench is reshuffled so the Voltorb that ends up paying is NOT the one the
// name-only default attaches to — so the default assignment leaves the payer
// starved (a shortfall) and only the other assignment is feasible.
const CONSTRAINED = `${SETUP}
alice's Turn
alice played (setX_1) Voltorb to the Bench.
alice played (setX_1) Voltorb to the Bench.
alice attached (mee_1) Basic Lightning Energy to (setX_1) Voltorb on the Bench.
alice retreated (base_1) Pikachu to the Bench.
alice's (setX_1) Voltorb is now in the Active Spot.
alice ended their turn.

bob's Turn
bob ended their turn.

alice's Turn
alice retreated (setX_1) Voltorb to the Bench.
alice's (setX_1) Voltorb is now in the Active Spot.
alice ended their turn.

bob's Turn
bob ended their turn.

alice's Turn
alice retreated (setX_1) Voltorb to the Bench.
- Basic Lightning Energy was discarded from alice's (setX_1) Voltorb.
alice's (setX_1) Voltorb is now in the Active Spot.
alice ended their turn.
`;

describe("solveEnergyAttribution — constrained by a later retreat", () => {
  const parsed = normalizePerspective(parseBattleLog(CONSTRAINED), "alice");

  it("the naive default assignment starves the paying instance", () => {
    // Sanity: the scenario actually exercises a shortfall at defaults, so the
    // solver has something to fix. (If this ever hits 0 the fixture stopped
    // testing the constraint.)
    expect(shortfalls(parsed)).toBeGreaterThan(0);
  });

  it("the solver finds the feasible assignment (zero shortfalls)", () => {
    const oracle = solveEnergyAttribution(parsed);
    expect(shortfalls(parsed, oracle)).toBe(0);
  });
});
