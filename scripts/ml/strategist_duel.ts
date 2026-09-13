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
import { loadBenchmarkDecks } from "@/lib/ml/benchmarkDecks";
import { createBoardEvaluator } from "@/lib/ml/botEvaluator";
import { numOrNull } from "@/lib/ml/features";
import { SearchPolicy } from "@/lib/ml/strategist/searchPolicy";
import { RankerPolicy } from "@/lib/ml/rankerPolicy";
import { readPolicyArtifactFile } from "@/lib/ml/policyModel";

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
// The opponent to measure against. "heuristic" is the FLOOR, not the target —
// the planner is only at parity with it (51.53%, not separable), so beating
// the heuristic proves less than beating the planner.
const VS = arg("--vs") ?? "planner";
if (VS !== "planner" && VS !== "heuristic") {
  console.error(`[strategist-duel] --vs expects planner|heuristic, got ${JSON.stringify(VS)}`);
  process.exit(1);
}
const ARTIFACT = arg("--artifact");
const STOCK_DECK = !process.argv.includes("--no-stock-deck");
// Side A: the rolled-out search, or a ranker artifact to gate. Both are
// measured on the SAME true-mirror harness so a distilled student's number is
// directly comparable with the teacher's 71.81%.
const A_SPEC = arg("--a") ?? "search";
// Expert Iteration, second half: hand the apprentice back to the expert as a
// move-ordering prior so rollouts are spent only on plausible candidates.
const PRIOR_PATH = arg("--prior");
const PRIOR_TOPK = numArg("--prior-topk", 6);

function main(): void {
  const evaluate = createBoardEvaluator(ARTIFACT ?? undefined);
  if (!evaluate) {
    console.error("[strategist-duel] no usable value artifact — refusing to run.");
    console.error("  A silent fallback here would compare two different stacks.");
    process.exit(1);
  }
  const decks = loadBenchmarkDecks(DECKS_FILE);
  const priorArtifact = PRIOR_PATH
    ? readPolicyArtifactFile(path.resolve(REPO_ROOT, PRIOR_PATH))
    : null;
  if (PRIOR_PATH && !priorArtifact) {
    console.error(`[strategist-duel] no usable prior artifact at ${PRIOR_PATH}`);
    process.exit(1);
  }
  const rankerArtifact = A_SPEC.startsWith("ranker:")
    ? readPolicyArtifactFile(path.resolve(REPO_ROOT, A_SPEC.slice("ranker:".length)))
    : null;
  if (A_SPEC.startsWith("ranker:") && !rankerArtifact) {
    console.error(`[strategist-duel] no usable policy artifact at ${A_SPEC.slice(7)}`);
    process.exit(1);
  }

  if (rankerArtifact) console.log(`A: RankerPolicy ${rankerArtifact.model_version}`);
  else console.log(
    `A: SearchPolicy rollouts=${ROLLOUTS} horizon=${HORIZON ?? "end"} ` +
      `maxCand=${MAX_CANDIDATES} determinize=${DETERMINIZE} stockDeck=${STOCK_DECK}` +
      (PRIOR_PATH ? ` prior=${path.basename(PRIOR_PATH)} topK=${PRIOR_TOPK}` : ""),
  );
  console.log(
    `B: ${VS === "heuristic" ? "HeuristicPolicy" : `PlannerPolicy skill=${SKILL} + value artifact`}`,
  );
  console.log(
    `${GAMES} true-mirror games x ${SEEDS} seeds over ${decks.length} benchmark decks\n`,
  );

  let poolA = 0;
  let poolB = 0;
  let poolD = 0;
  const perSeed: number[] = [];
  const statTotals = {
    decisions: 0,
    searched: 0,
    trivial: 0,
    tooWide: 0,
    unmapped: 0,
    byName: 0,
    pruned: 0,
  };
  let searchSeconds = 0;
  // Corpus sanity: a shift in HOW games end is a label-quality confound
  // wearing a result's clothes. A win driven by the opponent decking out, or
  // by a rising turn-cap rate, is a different claim from a win on prizes.
  const endReasons: Record<string, number> = {};
  let totalTurns = 0;
  // WHO runs out of cards decides what an elevated deck-out rate means. If
  // the opponent decks out, the search found an attrition line (legitimate,
  // but narrow — it may not transfer to an opponent who manages resources).
  // If WE deck out, the search is burning its own library.
  let deckOutByA = 0;
  let deckOutByB = 0;
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

      const a: DecisionPolicy = A_SPEC.startsWith("ranker:")
        ? new RankerPolicy(rankerArtifact!, { seed: gameSeed })
        : new SearchPolicy({
        rollouts: ROLLOUTS,
        horizon: HORIZON,
        evaluate: evaluate as StateEvaluator,
        seed: gameSeed,
        determinize: DETERMINIZE,
        maxCandidates: MAX_CANDIDATES,
        stockDeck: STOCK_DECK,
            prior: priorArtifact,
            priorTopK: PRIOR_TOPK,
          });
      const search = a instanceof SearchPolicy ? a : null;
      const planner: DecisionPolicy =
        VS === "heuristic"
          ? new HeuristicPolicy()
          : new PlannerPolicy({
              params: plannerParamsForSkill(SKILL),
              seed: (gameSeed ^ 0x85ebca6b) >>> 0,
              evaluate: evaluate as StateEvaluator,
            });

      const out = playGame(
        d,
        d,
        aIsPlayer ? { player: a, opponent: planner } : { player: planner, opponent: a },
        mulberry32(gameSeed),
        firstActor,
      );
      endReasons[out.endReason] = (endReasons[out.endReason] ?? 0) + 1;
      totalTurns += out.turns;
      if (out.endReason === "deck_out" && out.winner !== null) {
        // The deck-out LOSER is the side that could not draw.
        if ((out.winner === "player") === aIsPlayer) deckOutByB += 1;
        else deckOutByA += 1;
      }
      if (out.winner === null) draws += 1;
      else if ((out.winner === "player") === aIsPlayer) aWins += 1;
      else bWins += 1;

      if (search) {
        statTotals.decisions += search.stats.decisions;
        statTotals.searched += search.stats.searched;
        statTotals.trivial += search.stats.trivial;
        statTotals.tooWide += search.stats.tooWide;
        statTotals.unmapped += search.stats.unmapped;
        statTotals.byName += search.stats.byName;
        statTotals.pruned += search.stats.pruned;
        searchSeconds += search.stats.secondsPerSearch * search.stats.searched;
      }
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
      ? `  A BEATS the ${VS} — separable at 95%.`
      : hi < 0.5
        ? `  A LOSES to the ${VS} — separable at 95%.`
        : "  NOT SEPARABLE from 50%.",
  );

  const totalGames = GAMES * SEEDS;
  console.log(
    `\nend reasons: ` +
      Object.entries(endReasons)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k} ${((100 * n) / totalGames).toFixed(1)}%`)
        .join(", ") +
      `  |  avg turns ${(totalTurns / totalGames).toFixed(1)}`,
  );
  if (deckOutByA + deckOutByB > 0) {
    console.log(
      `  of the deck-outs: ${deckOutByB} were B running dry (A wins by ` +
        `attrition), ${deckOutByA} were A running dry`,
    );
  }

  const d = statTotals;
  // A ranker arm searches nothing, so the search-coverage block below would
  // print a row of zeros that reads like a failure.
  if (d.decisions === 0) return;
  console.log(
    `\nsearch coverage: ${d.searched}/${d.decisions} decisions searched ` +
      `(${((100 * d.searched) / Math.max(1, d.decisions)).toFixed(1)}%), ` +
      `${d.trivial} trivial, ${d.tooWide} too wide, ${d.byName} mapped by name, ` +
      `${d.unmapped} unmapped` +
      (d.pruned > 0
        ? `, ${d.pruned} candidates pruned by the prior ` +
          `(${(d.pruned / Math.max(1, d.searched)).toFixed(1)} per searched decision)`
        : ""),
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
