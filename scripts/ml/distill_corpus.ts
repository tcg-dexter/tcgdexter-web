// Capture the search's Q values as training labels.
//
// WHY THIS IS DIFFERENT FROM THE CORPUS THAT CAME BEFORE
//
// `ml_train_policy.py` trained a conditional-logit ranker on IMITATION: one
// label per decision, "the teacher played move 4", advantage-weighted by the
// eventual game result. It saturated at top-1 0.5038 — identical to four
// decimals across a 36x data range (25k / 150k / 890k decisions) — and lost
// its duel at 43.23%. Imitation cannot exceed its teacher, and the teacher
// was a hand-written priority list at heuristic strength.
//
// A rolled-out search values EVERY legal move, so one decision yields K
// labelled examples carrying MAGNITUDES, not one example carrying a choice.
// That is counterfactual supervision, and it has no teacher ceiling.
//
// It is also free. SearchPolicy must value every candidate in order to pick
// one, so the labels fall out of play rather than costing a second pass:
// this script runs self-play and writes down what the search already
// computed.
//
// Output is JSONL, one decision per line, sparse-encoded (the state vector is
// 272 wide and mostly zero):
//   { g, turn, state: {idx: v}, cands: [{kind, a: {idx: v}}], q: [...], chosen }
//
// Usage:
//   npx tsx scripts/ml/distill_corpus.ts --games 300 --out corpus.jsonl
//     [--rollouts 8] [--horizon 6] [--seed 1] [--opponent search|planner]

import { createWriteStream } from "node:fs";
import path from "node:path";

import {
  PlannerPolicy,
  hashSeed,
  instantiateDeck,
  mulberry32,
  playGame,
  plannerParamsForSkill,
  type DecisionPolicy,
  type StateEvaluator,
} from "@/lib/engine/sim";
import { loadBenchmarkDecks } from "@/lib/ml/benchmarkDecks";
import { createBoardEvaluator } from "@/lib/ml/botEvaluator";
import { numOrNull } from "@/lib/ml/features";
import {
  POLICY_SCHEMA_VERSION,
  encodeActionFeatures,
  encodeStateFeatures,
} from "@/lib/ml/features/policy";
import { seedOrLabel } from "@/lib/ml/features/guards";
import { SearchPolicy } from "@/lib/ml/strategist/searchPolicy";
import type { DecisionAnalysis } from "@/lib/ml/strategist/regret";
import type { PlayerView, TurnContext } from "@/lib/engine/sim";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
function numArg(flag: string, fallback: number): number {
  const raw = arg(flag);
  if (raw === null) return fallback;
  const n = numOrNull(raw);
  if (n === null) {
    console.error(`[distill] ${flag} expects a number, got ${JSON.stringify(raw)}`);
    process.exit(1);
  }
  return n;
}

const DECKS_FILE =
  arg("--decks-file") ?? path.resolve(REPO_ROOT, "data/ml/benchmark-decks.json");
const GAMES = numArg("--games", 200);
const ROLLOUTS = numArg("--rollouts", 8);
const HORIZON = numArg("--horizon", 6);
const SEED = seedOrLabel(arg("--seed"), 1, hashSeed);
const OUT = arg("--out") ?? "distill_corpus.jsonl";
const OPPONENT = arg("--opponent") ?? "planner";

/** Sparse-encode a dense vector: 272 state features are mostly zero, and the
 *  corpus is large enough that the difference matters on disk. */
function sparse(vec: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < vec.length; i++) if (vec[i] !== 0) out[String(i)] = vec[i];
  return out;
}

function main(): void {
  const evaluate = createBoardEvaluator();
  if (!evaluate) {
    console.error("[distill] no usable value artifact — refusing to run.");
    process.exit(1);
  }
  const decks = loadBenchmarkDecks(DECKS_FILE);
  const out = createWriteStream(path.resolve(REPO_ROOT, OUT), { flags: "w" });

  console.log(
    `[distill] ${GAMES} games, rollouts=${ROLLOUTS} horizon=${HORIZON}, ` +
      `opponent=${OPPONENT}, schema v${POLICY_SCHEMA_VERSION} -> ${OUT}`,
  );

  let decisions = 0;
  let candidates = 0;
  const startedAt = Date.now();

  for (let g = 0; g < GAMES; g++) {
    const combo = g % 4;
    const d = instantiateDeck(decks[Math.floor(g / 4) % decks.length].list);
    const gameSeed = hashSeed(`distill:${SEED}:${g}`);
    const aIsPlayer = combo % 2 === 0;
    const firstActor = combo < 2 ? ("player" as const) : ("opponent" as const);

    const capture = (
      view: PlayerView,
      _ctx: TurnContext,
      analysis: DecisionAnalysis,
    ) => {
      const state = sparse(encodeStateFeatures(view));
      const cands = analysis.candidates.map((c) => ({
        kind: c.move.kind,
        a: sparse(encodeActionFeatures(view, c.move)),
      }));
      out.write(
        JSON.stringify({
          g,
          turn: analysis.turn,
          state,
          cands,
          q: analysis.candidates.map((c) => Number(c.q.toFixed(5))),
          chosen: analysis.bestIndex,
        }) + "\n",
      );
      decisions += 1;
      candidates += cands.length;
    };

    const mk = (seed: number) =>
      new SearchPolicy({
        rollouts: ROLLOUTS,
        horizon: HORIZON,
        evaluate: evaluate as StateEvaluator,
        seed,
        determinize: true,
        maxCandidates: 24,
        onAnalysis: capture,
      });

    const search = mk(gameSeed);
    // The OPPONENT decides which states get visited. A planner opponent keeps
    // the state distribution close to the incumbent's, which is the
    // distribution a distilled student will actually be duelled on; a search
    // opponent visits stronger positions. Both are captured, since the hook
    // is on whichever SearchPolicy instances exist.
    const other: DecisionPolicy =
      OPPONENT === "search"
        ? mk((gameSeed ^ 0x5bf03635) >>> 0)
        : new PlannerPolicy({
            params: plannerParamsForSkill(1),
            seed: (gameSeed ^ 0x85ebca6b) >>> 0,
            evaluate: evaluate as StateEvaluator,
          });

    playGame(
      d,
      d,
      aIsPlayer ? { player: search, opponent: other } : { player: other, opponent: search },
      mulberry32(gameSeed),
      firstActor,
    );

    if ((g + 1) % 25 === 0) {
      const el = (Date.now() - startedAt) / 1000;
      console.log(
        `  ${g + 1}/${GAMES} games  ${decisions} decisions  ` +
          `${(decisions / el).toFixed(1)}/s  ${el.toFixed(0)}s`,
      );
    }
  }

  out.end();
  const el = (Date.now() - startedAt) / 1000;
  console.log(
    `[distill] ${decisions} decisions, ${candidates} candidates ` +
      `(${(candidates / Math.max(1, decisions)).toFixed(1)} per decision) in ${el.toFixed(0)}s`,
  );
}

main();
