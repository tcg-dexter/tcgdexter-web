/**
 * Value-model promotion gate: does this evaluator make the bot PLAY BETTER?
 *
 * ml_train_value_gbm.py ends with "Offline wins are necessary, not
 * sufficient. Promotion is earned by the duel against HeuristicPolicy in
 * true mirror matches on the frozen benchmark." That duel had no script —
 * policy_duel.ts is the RANKER's gate and loads a policy artifact, not a
 * value artifact. This is the missing one.
 *
 * It is deliberately a different question from scripts/ml/calibration.ts.
 * Calibration asks whether the simulated META matches the real meta, which
 * is dominated by how evenly the bot pilots DIFFERENT archetypes. This asks
 * whether the bot plays a given deck WELL. A model can win here and lose
 * there — and the v19 GBM did exactly that — so both must be consulted, for
 * different decisions: this one gates the gameplay UI, calibration gates
 * deck grading.
 *
 * TRUE MIRROR: both seats play the SAME deck, so the only difference is the
 * evaluator. Seat and initiative both alternate, because value_gate.ts
 * documents how a seat/initiative confound once faked a result here.
 *
 *   npx tsx scripts/ml/value_duel.ts --a data/ml/value.json --b heuristic
 *   npx tsx scripts/ml/value_duel.ts --a <candidate> --b data/ml/value.json
 */

import { loadBenchmarkDecks } from "@/lib/ml/benchmarkDecks";
import {
  HeuristicPolicy,
  PlannerPolicy,
  hashSeed,
  instantiateDeck,
  mulberry32,
  playGame,
  plannerParamsForSkill,
  type DecisionPolicy,
} from "@/lib/engine/sim";
import { createBoardEvaluator } from "@/lib/ml/botEvaluator";
import type { StateEvaluator } from "@/lib/engine/sim/planner";

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
const A = arg("--a") ?? "data/ml/value.json";
const B = arg("--b") ?? "heuristic";
const GAMES = Number(arg("--games") ?? 120);
const SEED = arg("--seed") ?? "value-duel";
const SKILL = Number(arg("--skill") ?? 1);
const DECKS_FILE = arg("--decks-file") ?? "data/ml/benchmark-decks.json";

/** "heuristic" means the plain HeuristicPolicy (no planner, no model) —
 *  the floor every value model must clear. "none" means the planner with its
 *  built-in heuristicEvaluator, which isolates the MODEL's contribution from
 *  the SEARCH's. */
type Side = { label: string; make: (seed: number) => DecisionPolicy };

function sideFor(spec: string): Side {
  if (spec === "heuristic") {
    return { label: "HeuristicPolicy", make: () => new HeuristicPolicy() };
  }
  const params = plannerParamsForSkill(SKILL);
  if (spec === "none") {
    return {
      label: "planner (built-in evaluator)",
      make: (seed) => new PlannerPolicy({ params, seed }),
    };
  }
  const evaluate = createBoardEvaluator(spec);
  if (!evaluate) {
    console.error(`[value-duel] no usable value artifact at ${spec}`);
    process.exit(1);
  }
  return {
    label: `planner + ${spec}`,
    make: (seed) => new PlannerPolicy({ params, seed, evaluate: evaluate as StateEvaluator }),
  };
}

function main(): void {
  const a = sideFor(A);
  const b = sideFor(B);
  const decks = loadBenchmarkDecks(DECKS_FILE);
  if (decks.length === 0) {
    console.error("[value-duel] benchmark fixture is empty");
    process.exit(1);
  }

  console.log(`A: ${a.label}`);
  console.log(`B: ${b.label}`);
  console.log(`${GAMES} true-mirror games over ${decks.length} benchmark decks, skill ${SKILL}\n`);

  let aWins = 0;
  let bWins = 0;
  let draws = 0;
  for (let g = 0; g < GAMES; g++) {
    const d = instantiateDeck(decks[g % decks.length].list);
    const gameSeed = hashSeed(`${SEED}:${g}`);
    // Alternate BOTH which seat A occupies and who moves first, so neither
    // the seat nor the initiative advantage can accumulate on one side.
    const aIsPlayer = g % 2 === 0;
    const firstActor = g % 4 < 2 ? ("player" as const) : ("opponent" as const);
    const pa = a.make(gameSeed);
    const pb = b.make((gameSeed ^ 0x85ebca6b) >>> 0);
    const out = playGame(
      d,
      d,
      aIsPlayer ? { player: pa, opponent: pb } : { player: pb, opponent: pa },
      mulberry32(gameSeed),
      firstActor,
    );
    if (out.winner === null) draws += 1;
    else if ((out.winner === "player") === aIsPlayer) aWins += 1;
    else bWins += 1;
  }

  const decided = aWins + bWins;
  const rate = decided > 0 ? aWins / decided : 0;
  // Normal approximation is fine at these n; this is the honest ± on the rate.
  const se = decided > 0 ? Math.sqrt((rate * (1 - rate)) / decided) : 0;
  console.log(`A ${aWins} — ${bWins} B   (${draws} draws)`);
  console.log(`A win rate: ${(rate * 100).toFixed(1)}%  ±${(se * 196).toFixed(1)} (95% CI)`);
  const beats = rate - 1.96 * se > 0.5;
  const loses = rate + 1.96 * se < 0.5;
  console.log(
    beats
      ? "\n  A BEATS B — significant at 95%."
      : loses
        ? "\n  A LOSES to B — significant at 95%."
        : "\n  NO SIGNIFICANT DIFFERENCE — the CI spans 50%. Do not promote on this.",
  );
}

main();
