// SearchPolicy (rolled-out regret, 100% of decisions) vs PlannerPolicy
// (four-slot template + the development prior that owns 89.2% of decisions).
//
// True MIRROR matches: both sides play the same deck, so deck strength
// cancels completely and the result is about piloting alone.
//
// The (seat, initiative) cycling below is value_duel.ts's corrected scheme,
// copied deliberately. The obvious `deck = g % decks.length` with a mod-4
// combo cycle breaks whenever 4 divides the deck count — with 12 benchmark
// decks every deck was locked to ONE combination, first-player advantage
// never cancelled, and the same configuration scored 39.1% and 56.1% on
// different seeds.
//
// Multi-seed is built in rather than left to a shell loop, because every
// single-seed reading this project has taken has been wrong: 47.1% vs 44.22%,
// 55.5% vs 50.60%, McNemar 2.50 vs 1.73, and a 3-seed 51.9% that settled at
// 50.17%. The pooled figure is the only one to quote.
//
// Usage:
//   npx tsx scripts/ml/strategist_duel.ts [--games 120] [--seeds 4]
//     [--rollouts 8] [--horizon 6] [--max-candidates 24] [--skill 1]
//     [--no-determinize] [--artifact PATH]

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
import { SearchPolicy } from "@/lib/ml/strategist/searchPolicy";

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
    console.error(`[strategist-duel] ${flag} expects a number, got ${JSON.stringify(raw)}`);
    process.exit(1);
  }
  return n;
}

const DECKS_FILE =
  arg("--decks-file") ?? path.resolve(REPO_ROOT, "data/ml/benchmark-decks.json");
const GAMES = numArg("--games", 120);
const SEEDS = numArg("--seeds", 4);
const ROLLOUTS = numArg("--rollouts", 8);
const HORIZON_RAW = arg("--horizon");
const HORIZON = HORIZON_RAW === "none" ? null : numArg("--horizon", 6);
const MAX_CANDIDATES = numArg("--max-candidates", 24);
const SKILL = numArg("--skill", 1);
const DETERMINIZE = !process.argv.includes("--no-determinize");
const ARTIFACT = arg("--artifact");

function main(): void {
  const evaluate = createBoardEvaluator(ARTIFACT ?? undefined);
  if (!evaluate) {
    console.error("[strategist-duel] no usable value artifact — refusing to run.");
    console.error("  A silent fallback here would compare two different stacks.");
    process.exit(1);
  }
  const decks = loadBenchmarkDecks(DECKS_FILE);

  console.log(
    `A: SearchPolicy rollouts=${ROLLOUTS} horizon=${HORIZON ?? "end"} ` +
      `maxCand=${MAX_CANDIDATES} determinize=${DETERMINIZE}`,
  );
  console.log(`B: PlannerPolicy skill=${SKILL} + value artifact`);
  console.log(
    `${GAMES} true-mirror games x ${SEEDS} seeds over ${decks.length} benchmark decks\n`,
  );

  let poolA = 0;
  let poolB = 0;
  let poolD = 0;
  const perSeed: number[] = [];
  const statTotals = { decisions: 0, searched: 0, trivial: 0, tooWide: 0, unmapped: 0, byName: 0 };
  let searchSeconds = 0;
  const startedAt = Date.now();

  for (let s = 0; s < SEEDS; s++) {
    let aWins = 0;
    let bWins = 0;
    let draws = 0;
    for (let g = 0; g < GAMES; g++) {
      const combo = g % 4;
      const d = instantiateDeck(decks[Math.floor(g / 4) % decks.length].list);
      const gameSeed = hashSeed(`strategist:${s}:${g}`);
      const aIsPlayer = combo % 2 === 0;
      const firstActor = combo < 2 ? ("player" as const) : ("opponent" as const);

      const search = new SearchPolicy({
        rollouts: ROLLOUTS,
        horizon: HORIZON,
        evaluate: evaluate as StateEvaluator,
        seed: gameSeed,
        determinize: DETERMINIZE,
        maxCandidates: MAX_CANDIDATES,
      });
      const planner: DecisionPolicy = new PlannerPolicy({
        params: plannerParamsForSkill(SKILL),
        seed: (gameSeed ^ 0x85ebca6b) >>> 0,
        evaluate: evaluate as StateEvaluator,
      });

      const out = playGame(
        d,
        d,
        aIsPlayer
          ? { player: search, opponent: planner }
          : { player: planner, opponent: search },
        mulberry32(gameSeed),
        firstActor,
      );
      if (out.winner === null) draws += 1;
      else if ((out.winner === "player") === aIsPlayer) aWins += 1;
      else bWins += 1;

      statTotals.decisions += search.stats.decisions;
      statTotals.searched += search.stats.searched;
      statTotals.trivial += search.stats.trivial;
      statTotals.tooWide += search.stats.tooWide;
      statTotals.unmapped += search.stats.unmapped;
      statTotals.byName += search.stats.byName;
      searchSeconds += search.stats.secondsPerSearch * search.stats.searched;
    }
    poolA += aWins;
    poolB += bWins;
    poolD += draws;
    const decided = aWins + bWins;
    const rate = decided > 0 ? aWins / decided : 0;
    perSeed.push(rate);
    console.log(
      `  seed ${s}: A ${aWins} — ${bWins} B (${draws} D)  ${(rate * 100).toFixed(1)}%`,
    );
  }

  const decided = poolA + poolB;
  const rate = decided > 0 ? poolA / decided : 0;
  const se = decided > 0 ? Math.sqrt((rate * (1 - rate)) / decided) : 0;
  const lo = rate - 1.96 * se;
  const hi = rate + 1.96 * se;
  const elapsed = (Date.now() - startedAt) / 1000;

  console.log(
    `\nPOOLED  ${poolA}W — ${poolB}L  (${poolD} draws)  n=${decided}  ` +
      `${(rate * 100).toFixed(2)}%  CI [${(lo * 100).toFixed(1)}, ${(hi * 100).toFixed(1)}]`,
  );
  console.log(
    lo > 0.5
      ? "  SearchPolicy BEATS the planner — separable at 95%."
      : hi < 0.5
        ? "  SearchPolicy LOSES to the planner — separable at 95%."
        : "  NOT SEPARABLE from 50%.",
  );

  const d = statTotals;
  console.log(
    `\nsearch coverage: ${d.searched}/${d.decisions} decisions searched ` +
      `(${((100 * d.searched) / Math.max(1, d.decisions)).toFixed(1)}%), ` +
      `${d.trivial} trivial, ${d.tooWide} too wide, ${d.byName} mapped by name, ` +
      `${d.unmapped} unmapped`,
  );
  if (d.unmapped > 0) {
    console.log(
      `  !! ${d.unmapped} searched moves could not be mapped back to the real ` +
        `legal set — ghost fidelity defect, not a tuning knob.`,
    );
  }
  console.log(
    `${elapsed.toFixed(0)}s total, ${(searchSeconds / Math.max(1, d.searched) * 1000).toFixed(0)} ms per searched decision`,
  );
}

main();
