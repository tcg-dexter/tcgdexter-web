// PROMOTION GATE for board-aware value models.
//
// A value model earns promotion HERE — by making the planner beat the plain
// hand-written HeuristicPolicy in head-to-head play — and never by offline
// metrics. Offline log-loss is measured on each model's own data generation,
// so two models' offline numbers are not even mutually comparable; the only
// common currency is games won.
//
// The measurement discipline below is not optional. Every rule exists
// because violating it once produced a wrong conclusion:
//
//   1. TRUE MIRROR: the same deck on BOTH sides. Handing the two policies
//      different decks measures deck strength, not policy strength (this
//      produced a confident, entirely bogus "43.8%" reading).
//   2. BOTH SEAT DIRECTIONS, pooled. Going first is a real edge; a result
//      that only holds in one seat is not a result.
//   3. SAME-POLICY CONTROLS. Planner-vs-planner and heuristic-vs-heuristic
//      must land near 50%. If they don't, the harness is measuring something
//      other than what it claims and the headline number means nothing.
//   4. n >= 1440 for a promotion decision. At n=480 the 95% CI is +-4.5%,
//      far too wide to resolve the 2-3 point effects at stake here.
//   5. FROZEN DECKS. data/meta-decks.json is refreshed AND REORDERED daily,
//      so front-slicing it makes results incomparable across days. The
//      benchmark fixture exists to kill that confound.
//
// Usage:
//   npx tsx scripts/ml/value_gate.ts [--games N] [--seed S]
//                                    [--artifact PATH] [--decks-file PATH]
//                                    [--skip-controls]
//
// --artifact points at a CANDIDATE model, bypassing the registry so it can be
// measured before it is promoted. Omit it to measure whatever is currently
// enabled in the registry.

import path from "node:path";

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
  type StateEvaluator,
} from "@/lib/engine/sim";
import { numOrNull } from "@/lib/ml/features";
import { createBoardEvaluator, readValueArtifact } from "@/lib/ml/botEvaluator";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

const games = numOrNull(argValue("--games")) ?? 1440;
const seed = numOrNull(argValue("--seed")) ?? 11;
const artifactArg = argValue("--artifact");
const skipControls = process.argv.includes("--skip-controls");
const decksFile = argValue("--decks-file") ?? path.join("data", "ml", "benchmark-decks.json");

type PolicyFactory = (gameSeed: number) => DecisionPolicy;

/**
 * Play `games` true-mirror games, alternating which seat side A occupies so
 * both directions are covered, and report side A's pooled score with draws
 * counted as half.
 */
function pooled(
  decks: { id: string; list: string }[],
  makeA: PolicyFactory,
  makeB: PolicyFactory,
  label: string,
): { p: number; lo: number; hi: number; bySeat: [number, number] } {
  let score = 0;
  const seatScore = [0, 0];
  const seatGames = [0, 0];

  for (let g = 0; g < games; g++) {
    const gameSeed = hashSeed(`${label}:${seed}:${g}`);
    // TRUE MIRROR: one deck, both sides.
    const deck = decks[g % decks.length];
    const sim = instantiateDeck(deck.list);
    // Alternate A's seat every game, and the first actor every two, so the
    // (seat, initiative) combinations are balanced across the run.
    const aSeat: "player" | "opponent" = g % 2 === 0 ? "player" : "opponent";
    const firstActor: "player" | "opponent" =
      Math.floor(g / 2) % 2 === 0 ? "player" : "opponent";

    const a = makeA(gameSeed);
    const b = makeB(gameSeed);
    const outcome = playGame(
      sim,
      instantiateDeck(deck.list),
      {
        player: aSeat === "player" ? a : b,
        opponent: aSeat === "opponent" ? a : b,
      },
      mulberry32(gameSeed),
      firstActor,
      {},
    );

    const s = outcome.winner === null ? 0.5 : outcome.winner === aSeat ? 1 : 0;
    score += s;
    const si = aSeat === "player" ? 0 : 1;
    seatScore[si] += s;
    seatGames[si] += 1;
  }

  const p = score / games;
  const half = 1.96 * Math.sqrt((p * (1 - p)) / games);
  return {
    p,
    lo: Math.max(0, p - half),
    hi: Math.min(1, p + half),
    bySeat: [seatScore[0] / seatGames[0], seatScore[1] / seatGames[1]],
  };
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

function report(label: string, r: ReturnType<typeof pooled>): void {
  console.log(
    `  ${label.padEnd(34)} ${pct(r.p)}  [${pct(r.lo)}–${pct(r.hi)}]  ` +
      `seats: ${pct(r.bySeat[0])} / ${pct(r.bySeat[1])}`,
  );
}

function main(): void {
  const decks = loadBenchmarkDecks(path.resolve(REPO_ROOT, decksFile));
  if (decks.length === 0) throw new Error("gate: no usable benchmark decks");

  const evaluator: StateEvaluator | null = artifactArg
    ? createBoardEvaluator(path.resolve(REPO_ROOT, artifactArg))
    : createBoardEvaluator();
  if (!evaluator) {
    console.error(
      "[gate] no board-aware evaluator available — check --artifact, " +
        "DEXTER_VALUE_ARTIFACT, or the models.value registry entry",
    );
    process.exitCode = 1;
    return;
  }
  const meta = readValueArtifact(
    artifactArg ? path.resolve(REPO_ROOT, artifactArg) : undefined,
  );

  console.log(
    `[gate] model=${meta?.model_version ?? "?"} (${meta?.model_type ?? "?"}) ` +
      `games=${games} seed=${seed} decks=${decks.length} (${path.basename(decksFile)})`,
  );
  if (games < 1440) {
    console.log(
      "[gate] WARNING: n < 1440 — the CI is too wide to support a promotion decision",
    );
  }

  const planner: PolicyFactory = (gameSeed) =>
    new PlannerPolicy({
      params: plannerParamsForSkill(1.0),
      seed: (gameSeed ^ 0x85ebca6b) >>> 0,
      evaluate: evaluator,
    });
  // A distinct seed salt, so the same-policy control is two INDEPENDENT
  // instances of the policy rather than a mirror of one RNG stream.
  const plannerB: PolicyFactory = (gameSeed) =>
    new PlannerPolicy({
      params: plannerParamsForSkill(1.0),
      seed: (gameSeed ^ 0xc2b2ae35) >>> 0,
      evaluate: evaluator,
    });
  const heuristic: PolicyFactory = () => new HeuristicPolicy();

  console.log("");
  console.log("  matchup                            score   95% CI          player / opponent");
  const headline = pooled(decks, planner, heuristic, "gate");
  report("planner+value vs heuristic", headline);

  if (!skipControls) {
    report("CONTROL planner vs planner", pooled(decks, planner, plannerB, "ctl-p"));
    report("CONTROL heuristic vs heuristic", pooled(decks, heuristic, heuristic, "ctl-h"));
  }

  console.log("");
  const beats = headline.lo > 0.5;
  console.log(
    beats
      ? `  => PASS: beats HeuristicPolicy, CI excludes 50% (low end ${pct(headline.lo)}).`
      : `  => NOT PROVEN: CI [${pct(headline.lo)}–${pct(headline.hi)}] includes 50%.`,
  );
  console.log("  Controls must sit near 50% for the headline to mean anything.");
}

main();
