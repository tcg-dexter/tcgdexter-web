import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizePerspective, parseBattleLog } from "@/lib/battle-log";
import { replay } from "./replay";
import { solveEnergyAttribution } from "./energyAttribution";

// Real match a11father vs Gworgeo007. a11father evolves two N's Zoroark ex of
// the same printing (sv9_175) and attaches three Basic Darkness Energy to "a
// Zoroark ex on the Bench" — ambiguous. Later one Zoroark retreats discarding
// exactly two Darkness (a hard 2-of constraint on that instance), which the
// solver must respect instead of piling all three on the first duplicate.
const LOG = readFileSync(
  join(__dirname, "fixtures", "a11father-zoroark.txt"),
  "utf8",
);

function shortfalls(res: ReturnType<typeof replay>) {
  return res.diagnostics.filter((d) => d.code === "energy_discard_shortfall")
    .length;
}

/** Energy counts on each in-play same-printing (sv9_175) Zoroark. */
function zoroarkEnergy(res: ReturnType<typeof replay>): number[] {
  const p = res.finalState.sides.player;
  const inPlay = p.active ? [p.active, ...p.bench] : [...p.bench];
  return inPlay
    .filter(
      (m) => m.card.name === "N's Zoroark ex" && m.card.printingId === "sv9_175",
    )
    .map((m) => m.attachedEnergy.length);
}

describe("energy attribution — real Zoroark match", () => {
  const parsed = normalizePerspective(parseBattleLog(LOG), "a11father");

  it("engages (the ambiguous same-printing attaches exist)", () => {
    const points: number[] = [];
    replay(parsed, {
      resolveAmbiguous: (info) => {
        if (info.candidateIds.length > 1) points.push(info.actionIndex);
        return undefined;
      },
    });
    expect(points.length).toBeGreaterThan(0);
  });

  it("the solver never raises more shortfalls than the naive default", () => {
    const base = shortfalls(replay(parsed));
    const oracle = solveEnergyAttribution(parsed);
    const solved = shortfalls(replay(parsed, { resolveAmbiguous: oracle }));
    expect(solved).toBeLessThanOrEqual(base);
  });

  it("de-piles the Darkness off one Zoroark that the name-only default heaps up", () => {
    // The name-only default piles every Darkness on the first duplicate; the
    // log constrains a retreating instance to ≥2, not an exact split, so this
    // isn't fully forced — but the solver still spreads it (feasible + more
    // balanced) rather than leaving one Zoroark with the whole stack.
    const before = zoroarkEnergy(replay(parsed));
    const oracle = solveEnergyAttribution(parsed);
    const after = zoroarkEnergy(replay(parsed, { resolveAmbiguous: oracle }));
    const total = before.reduce((n, e) => n + e, 0);
    expect(total).toBeGreaterThanOrEqual(2); // there is a stack to split
    // The worst single pile is strictly smaller than the all-on-one default.
    expect(Math.max(...after)).toBeLessThan(Math.max(...before));
    // And no energy is lost or invented in the redistribution.
    expect(after.reduce((n, e) => n + e, 0)).toBe(total);
  });
});
