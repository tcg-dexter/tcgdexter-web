// Skill-range calibration — how much does decision quality matter in THIS
// simulator at all?
//
// WHY. Our full ML stack beats a ~200-line hand-written rulebook 55/45. In
// chess that ratio would be 0/100, which admits two very different readings:
// either the engine is weak, or this sim compresses skill differences so
// hard that no decision engine can pull far ahead. Every conclusion in the
// strength ledger depends on which is true, and nothing measured so far
// distinguishes them.
//
// This runs the full ladder pairwise — random legal moves, the hand-written
// heuristic, the planner with its blind fallback evaluator, and the planner
// with the promoted value model — on the frozen benchmark, using the same
// measurement discipline as value_gate (true mirror, both seats, full
// seat x initiative cross product per deck).
//
// Read the RANDOM row first: it sets the scale. If random-vs-heuristic is
// ~20%, the sim has real dynamic range and our +5 over the rulebook is a
// modest slice of what is left. If it is ~40%, outcomes are dominated by
// shuffle luck and no amount of engine work will show up in the numbers.
//
// Usage:
//   npx tsx scripts/ml/skill_ladder.ts [--games N] [--seed S] [--decks-file P]

import path from "node:path";

import { loadBenchmarkDecks } from "@/lib/ml/benchmarkDecks";
import {
  HeuristicPolicy,
  PlannerPolicy,
  hashSeed,
  heuristicEvaluator,
  instantiateDeck,
  mulberry32,
  playGame,
  plannerParamsForSkill,
  promoteBest,
  type DecisionPolicy,
  type PlayerView,
  type SimMove,
  type TurnContext,
} from "@/lib/engine/sim";
import { numOrNull } from "@/lib/ml/features";
import { createBoardEvaluator } from "@/lib/ml/botEvaluator";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

const games = numOrNull(argValue("--games")) ?? 1440;
const seed = numOrNull(argValue("--seed")) ?? 31;
const decksFile = argValue("--decks-file") ?? path.join("data", "ml", "benchmark-decks.json");

/** Uniform over legal moves — the floor of the ladder. Seeded so a run is
 *  reproducible; promotion still uses the shared heuristic so a random side
 *  isn't handicapped by benching its worst Pokémon after every KO. */
class RandomPolicy implements DecisionPolicy {
  private readonly rng: () => number;
  constructor(seedValue: number) {
    this.rng = mulberry32(seedValue >>> 0);
  }
  chooseMove(_view: PlayerView, legal: SimMove[], _ctx: TurnContext): SimMove {
    if (legal.length === 0) return { kind: "pass" };
    return legal[Math.floor(this.rng() * legal.length)];
  }
  choosePromotion(view: PlayerView): number {
    return promoteBest(view.board.bench);
  }
}

type PolicyFactory = (gameSeed: number) => DecisionPolicy;

/** Identical scheduling discipline to value_gate.pooled: the deck is held
 *  for blocks of 4 games while the (seat, initiative) cross product sweeps,
 *  so deck identity can never alias with seat or with who moves first. */
function pooled(
  decks: { id: string; list: string }[],
  makeA: PolicyFactory,
  makeB: PolicyFactory,
  label: string,
): { p: number; lo: number; hi: number } {
  let score = 0;
  for (let g = 0; g < games; g++) {
    const gameSeed = hashSeed(`${label}:${seed}:${g}`);
    const deck = decks[Math.floor(g / 4) % decks.length];
    const combo = g % 4;
    const aSeat: "player" | "opponent" = combo < 2 ? "player" : "opponent";
    const aFirst = combo % 2 === 0;
    const firstActor: "player" | "opponent" = aFirst
      ? aSeat
      : aSeat === "player"
        ? "opponent"
        : "player";

    const a = makeA(gameSeed);
    const b = makeB(gameSeed);
    const outcome = playGame(
      instantiateDeck(deck.list),
      instantiateDeck(deck.list),
      {
        player: aSeat === "player" ? a : b,
        opponent: aSeat === "opponent" ? a : b,
      },
      mulberry32(gameSeed),
      firstActor,
      {},
    );
    score += outcome.winner === null ? 0.5 : outcome.winner === aSeat ? 1 : 0;
  }
  const p = score / games;
  const half = 1.96 * Math.sqrt((p * (1 - p)) / games);
  return { p, lo: Math.max(0, p - half), hi: Math.min(1, p + half) };
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

function main(): void {
  const decks = loadBenchmarkDecks(path.resolve(REPO_ROOT, decksFile));
  if (decks.length === 0) throw new Error("ladder: no usable benchmark decks");

  const valueEval = createBoardEvaluator();
  if (!valueEval) {
    console.error("[ladder] no value artifact — the top rung would duplicate blind planner");
    process.exitCode = 1;
    return;
  }

  const rungs: { name: string; make: PolicyFactory }[] = [
    { name: "random", make: (s) => new RandomPolicy(s ^ 0x1234567) },
    { name: "heuristic", make: () => new HeuristicPolicy() },
    {
      name: "planner(blind)",
      make: (s) =>
        new PlannerPolicy({
          params: plannerParamsForSkill(1.0),
          seed: (s ^ 0x85ebca6b) >>> 0,
          evaluate: heuristicEvaluator,
        }),
    },
    {
      name: "planner(value)",
      make: (s) =>
        new PlannerPolicy({
          params: plannerParamsForSkill(1.0),
          seed: (s ^ 0x85ebca6b) >>> 0,
          evaluate: valueEval,
        }),
    },
  ];

  console.log(
    `[ladder] games=${games}/pair seed=${seed} decks=${decks.length} ` +
      `(${path.basename(decksFile)})`,
  );
  console.log("");
  console.log("  matchup (row vs column)              score   95% CI");

  for (let i = 0; i < rungs.length; i++) {
    for (let j = i + 1; j < rungs.length; j++) {
      const r = pooled(decks, rungs[i].make, rungs[j].make, `ladder:${i}:${j}`);
      console.log(
        `  ${`${rungs[i].name} vs ${rungs[j].name}`.padEnd(36)} ${pct(r.p)}  ` +
          `[${pct(r.lo)}–${pct(r.hi)}]`,
      );
    }
  }
  console.log("");
  console.log("  Read the random rows first — they set the scale for every other number.");
}

main();
