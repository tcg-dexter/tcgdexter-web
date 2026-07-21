// Evaluator-discrimination diagnostic (Step 0).
//
// The learned value model is TRAINED as an absolute win-probability
// regressor, but its actual job inside the planner is to ORDER sibling
// candidate plans within one turn. Those are different objectives. The old
// blind snapshot evaluator failed precisely because its inputs barely moved
// between siblings, leaving the hand-tuned tactical terms to do all the
// ordering. This script measures whether value-v0 still has a milder form of
// that disease — and the answer picks the next step:
//
//   evaluator spread << tactical spread  -> fix the OBJECTIVE (ranking loss)
//   discriminates but noisily            -> raise CAPACITY (GBM / MLP)
//
// It plays planner-vs-planner games purely to generate realistic turns; the
// game results are irrelevant and not reported.
//
// Usage:
//   npx tsx scripts/ml/eval_probe.ts [--games N] [--seed S]
//                                    [--decks-file PATH] [--blind]
//
// --blind forces the 8-scalar snapshot evaluator, giving the known-bad
// reference point to calibrate the healthy-vs-flat reading against.

import path from "node:path";

import { loadBenchmarkDecks } from "@/lib/ml/benchmarkDecks";
import {
  PlannerPolicy,
  hashSeed,
  instantiateDeck,
  mulberry32,
  playGame,
  plannerParamsForSkill,
} from "@/lib/engine/sim";
import {
  startPlannerProbe,
  collectPlannerProbe,
  type ProbeCandidate,
} from "@/lib/engine/sim/planner";
import { numOrNull } from "@/lib/ml/features";
import { createBotEvaluator, createSnapshotEvaluator } from "@/lib/ml/botEvaluator";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

const games = numOrNull(argValue("--games")) ?? 40;
const seed = numOrNull(argValue("--seed")) ?? 7;
const blind = process.argv.includes("--blind");
const decksFile = argValue("--decks-file") ?? path.join("data", "ml", "benchmark-decks.json");

/* ─── stats helpers ─────────────────────────────────────────────── */

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const std = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
};
const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const argmax = (xs: number[]) => xs.reduce((best, x, i) => (x > xs[best] ? i : best), 0);
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

/* ─── main ──────────────────────────────────────────────────────── */

function main(): void {
  const decks = loadBenchmarkDecks(path.resolve(REPO_ROOT, decksFile));
  if (decks.length === 0) throw new Error("probe: no usable decks");

  const evaluator = blind ? createSnapshotEvaluator() : createBotEvaluator();
  console.log(
    `[probe] evaluator=${blind ? "snapshot(blind)" : "board-aware"} ` +
      `games=${games} seed=${seed} decks=${decks.length} (${path.basename(decksFile)})`,
  );
  if (!evaluator) throw new Error("probe: no evaluator available");

  startPlannerProbe();
  for (let g = 0; g < games; g++) {
    const gameSeed = hashSeed(`probe:${seed}:${g}`);
    // TRUE MIRROR: identical deck both sides, so nothing about the turns we
    // sample is an artifact of deck asymmetry.
    const deck = decks[g % decks.length];
    const mk = (salt: number) =>
      new PlannerPolicy({
        params: plannerParamsForSkill(1.0),
        seed: (gameSeed ^ salt) >>> 0,
        evaluate: evaluator,
      });
    playGame(
      instantiateDeck(deck.list),
      instantiateDeck(deck.list),
      { player: mk(0x85ebca6b), opponent: mk(0xc2b2ae35) },
      mulberry32(gameSeed),
      g % 2 === 0 ? "player" : "opponent",
      {},
    );
  }
  const turns = collectPlannerProbe();

  // Keep turns with a real choice and no terminal-shortcut leaves (those
  // never consulted the evaluator, so there is nothing to attribute).
  const usable = turns.filter(
    (t: ProbeCandidate[]) => t.length >= 2 && t.every((c) => Number.isFinite(c.evalPart)),
  );

  const evalSpreads: number[] = [];
  const tacSpreads: number[] = [];
  const evalStds: number[] = [];
  const tacStds: number[] = [];
  const ratios: number[] = [];
  let agree = 0;
  let flat = 0;

  for (const t of usable) {
    const e = t.map((c) => c.evalPart);
    const a = t.map((c) => c.tacticalPart);
    const total = t.map((c) => c.total);
    const es = spread(e);
    const as = spread(a);
    evalSpreads.push(es);
    tacSpreads.push(as);
    evalStds.push(std(e));
    tacStds.push(std(a));
    ratios.push(as > 0 ? es / as : es > 0 ? Infinity : 1);
    if (argmax(e) === argmax(total)) agree += 1;
    // "Flat" = the evaluator separates siblings by less than 1% win prob,
    // i.e. it is effectively abstaining from the ranking decision.
    if (es < 0.01) flat += 1;
  }

  const n = usable.length;
  console.log(`[probe] turns collected=${turns.length} usable=${n}`);
  console.log(`[probe] median candidates/turn=${median(usable.map((t) => t.length))}`);
  console.log("");
  console.log("  metric                         median      mean");
  const row = (label: string, xs: number[]) =>
    console.log(`  ${label.padEnd(28)} ${median(xs).toFixed(4).padStart(8)}  ${mean(xs).toFixed(4).padStart(8)}`);
  row("evaluator spread (max-min)", evalSpreads);
  row("tactical spread (max-min)", tacSpreads);
  row("evaluator std", evalStds);
  row("tactical std", tacStds);
  // Per-turn ratios have near-zero denominators, so only the median is
  // meaningful — the mean is dominated by a handful of divide-by-epsilon
  // turns. Report the ratio of medians alongside it as a robust check.
  const finiteRatios = ratios.filter(Number.isFinite);
  console.log(
    `  ${"median per-turn eval/tac ratio".padEnd(28)} ${median(finiteRatios).toFixed(4).padStart(8)}`,
  );
  console.log(
    `  ${"ratio of median spreads".padEnd(28)} ` +
      `${(median(evalSpreads) / median(tacSpreads)).toFixed(4).padStart(8)}`,
  );
  console.log("");
  console.log(`  argmax(evaluator) == argmax(final) : ${pct(agree / n)}`);
  console.log(`  turns where evaluator is flat      : ${pct(flat / n)}  (spread < 0.01)`);
  console.log("");
  console.log(
    median(finiteRatios) < 0.25
      ? "  => evaluator is NOT doing the ordering. Step 1a: ranking objective."
      : "  => evaluator discriminates. Step 1b: raise capacity (GBM/MLP).",
  );
}

main();
