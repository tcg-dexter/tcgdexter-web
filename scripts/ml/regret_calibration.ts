// Does the regret engine resolve anything? Measured before it is believed.
//
// The project's record on this is unambiguous: a 3-seed duel read 51.9% and
// settled at 50.17%; a 60-log McNemar read z=2.50 and settled at 1.73; a
// string `--seed` silently became 1 and produced a confident fake CI. So a new
// instrument gets calibrated before it gets used, and the calibration is a
// null and a positive control, not a demo.
//
//   NULL           the instrument's own best move, scored on independent
//                  rollouts, should have ~zero regret against itself. What it
//                  actually reports is the floor: no regret below this figure
//                  means anything, whatever its error bar says.
//   SELECTION BIAS max-of-K noisy means beats any fixed arm even when every
//                  arm is identical. Printed as naive-minus-crossfit so the
//                  size of the correction is visible.
//   STABILITY      how often two independent runs pick the same best move,
//                  alongside the spread of arm values (unstable argmax among
//                  arms worth the same thing is correct behaviour, not noise).
//   POSITIVE CTL   passing up an available attack must score as a large,
//                  significant loss. An instrument that cannot see that is
//                  not measuring play quality.
//
// Usage:
//   npx tsx scripts/ml/regret_calibration.ts [--decisions 60] [--rollouts 12]
//     [--horizon 6] [--games 8] [--seed 1] [--artifact PATH]

import path from "node:path";

import {
  HeuristicPolicy,
  PlannerPolicy,
  plannerParamsForSkill,
  viewFor,
  instantiateDeck,
  playGame,
  mulberry32,
  hashSeed,
  heuristicEvaluator,
  type DecisionObservation,
  type SimMove,
  type StateEvaluator,
  type TurnContext,
} from "@/lib/engine/sim";
import type { GameState } from "@/lib/engine/types";
import { loadBenchmarkDecks } from "@/lib/ml/benchmarkDecks";
import { createBoardEvaluator } from "@/lib/ml/botEvaluator";
import { numOrNull } from "@/lib/ml/features";
import { seedOrLabel } from "@/lib/ml/features/guards";
import { analyzeDecision, sameMove } from "@/lib/ml/strategist/regret";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const DECKS_FILE =
  arg("--decks-file") ?? path.resolve(REPO_ROOT, "data/ml/benchmark-decks.json");
const N_DECISIONS = numOrNull(arg("--decisions")) ?? 60;
const ROLLOUTS = numOrNull(arg("--rollouts")) ?? 12;
const HORIZON_RAW = arg("--horizon");
const HORIZON = HORIZON_RAW === "none" ? null : (numOrNull(HORIZON_RAW) ?? 6);
const GAMES = numOrNull(arg("--games")) ?? 8;
const SEED = seedOrLabel(arg("--seed"), 1, hashSeed);
const ARTIFACT = arg("--artifact");

interface Captured {
  state: GameState;
  actor: "player" | "opponent";
  ctx: TurnContext;
  move: SimMove;
  legalCount: number;
  hasAttack: boolean;
}

function collect(): Captured[] {
  const decks = loadBenchmarkDecks(DECKS_FILE);
  const out: Captured[] = [];
  for (let g = 0; g < GAMES; g++) {
    const d = instantiateDeck(decks[g % decks.length].list);
    const seed = hashSeed(`${SEED}:collect:${g}`);
    const onDecision = (ev: DecisionObservation) => {
      if (ev.legal.length < 2) return;
      out.push({
        // The driver hands over its live state by contract; keeping it means
        // cloning it.
        state: structuredClone(ev.state),
        actor: ev.actor,
        ctx: { ...ev.ctx },
        move: ev.move,
        legalCount: ev.legal.length,
        hasAttack: ev.legal.some((m) => m.kind === "attack"),
      });
    };
    playGame(
      d,
      d,
      { player: new HeuristicPolicy(), opponent: new HeuristicPolicy() },
      mulberry32(seed),
      g % 2 === 0 ? "player" : "opponent",
      { onDecision },
    );
  }
  return out;
}

function sample<T>(xs: T[], n: number, seed: number): T[] {
  const rng = mulberry32(seed);
  const idx = xs.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, n).map((i) => xs[i]);
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}
function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1));
}
function pct(x: number): string {
  return `${(x * 100).toFixed(2)}`;
}

function main(): void {
  let evaluate: StateEvaluator | null = null;
  if (HORIZON !== null) {
    evaluate = createBoardEvaluator(ARTIFACT ?? undefined);
    if (!evaluate) {
      console.log(
        "[regret-cal] no usable value artifact — falling back to heuristicEvaluator.",
      );
      console.log(
        "             This is a CALIBRATION of the search, not of the live stack.\n",
      );
      evaluate = heuristicEvaluator;
    }
  }

  const t0 = Date.now();
  const pool = collect();
  const picked = sample(
    pool.filter((c) => c.legalCount >= 2),
    N_DECISIONS,
    hashSeed(`${SEED}:pick`),
  );
  console.log(
    `${pool.length} decisions from ${GAMES} games; analyzing ${picked.length} ` +
      `at ${ROLLOUTS} rollouts x horizon ${HORIZON ?? "game end"}`,
  );
  console.log(
    `mean legal moves at a decision: ${mean(pool.map((c) => c.legalCount)).toFixed(1)}\n`,
  );

  const nullRegrets: number[] = [];
  const naiveRegrets: number[] = [];
  const crossRegrets: number[] = [];
  const spreads: number[] = [];
  const pairedSes: number[] = [];
  let stable = 0;
  let analyzed = 0;
  let controlN = 0;
  const controlRegrets: number[] = [];
  let controlSignificant = 0;
  let pilotMissing = 0;

  // DISCRIMINATION. The decisive check, and it is nearly free: one analysis
  // values every legal move, so any number of policies can be scored against
  // the same rollouts by reading off the arm each one would have picked.
  // The true ordering is known independently — planner ~ heuristic (51.53%,
  // not separable) and both far above random (agreement 33.7% vs 14.7%) — so
  // an instrument that fails to reproduce it is measuring something else.
  const rank: Record<string, number[]> = {
    pilot: [],
    heuristic: [],
    planner: [],
    random: [],
    worst: [],
  };

  for (let i = 0; i < picked.length; i++) {
    const c = picked[i];
    const base = { rollouts: ROLLOUTS, horizon: HORIZON, evaluate };
    const a = analyzeDecision(c.state, c.actor, c.ctx, c.move, {
      ...base,
      seed: hashSeed(`${SEED}:A:${i}`),
    });
    const b = analyzeDecision(c.state, c.actor, c.ctx, c.move, {
      ...base,
      seed: hashSeed(`${SEED}:B:${i}`),
    });
    if (!a || !b) continue;
    analyzed += 1;

    {
      const qs = a.candidates.map((x) => x.q);
      const best = Math.max(...qs);
      const legal = a.candidates.map((x) => x.move);
      const view = viewFor(c.state, c.actor, c.ctx);
      const qOf = (m: SimMove): number | null => {
        const j = a.candidates.findIndex((x) => sameMove(x.move, m));
        return j >= 0 ? qs[j] : null;
      };
      const record = (key: string, m: SimMove | null) => {
        if (!m) return;
        const q = qOf(m);
        if (q !== null) rank[key].push(best - q);
        else if (key === "pilot") pilotMissing += 1;
      };
      // The pilot's move came out of this same decision's legal set, so a
      // miss here is a move-identity BUG, not a statistic. Counted and
      // printed rather than quietly shrinking n.
      record("pilot", c.move);
      record("heuristic", new HeuristicPolicy().chooseMove(view, legal, c.ctx));
      record(
        "planner",
        new PlannerPolicy({
          params: plannerParamsForSkill(1),
          seed: hashSeed(`${SEED}:plan:${i}`),
          ...(evaluate ? { evaluate } : {}),
        }).chooseMove(view, legal, c.ctx),
      );
      const rr = mulberry32(hashSeed(`${SEED}:rand:${i}`));
      record("random", legal[Math.floor(rr() * legal.length)]);
      rank.worst.push(best - Math.min(...qs));
    }

    if (a.bestIndex === b.bestIndex) stable += 1;
    spreads.push(
      Math.max(...a.candidates.map((x) => x.q)) - Math.min(...a.candidates.map((x) => x.q)),
    );
    if (a.regret !== null) {
      naiveRegrets.push(a.regretNaive ?? 0);
      crossRegrets.push(a.regret);
      pairedSes.push(a.regretSe);
    }

    // NULL: run A's best move, valued on run B's independent rollouts and
    // compared against run B's value for the same move. Zero by construction
    // if the two runs agreed; the residual IS the instrument's noise floor.
    const aBest = a.candidates[a.bestIndex].move;
    const bIdx = b.candidates.findIndex((x) => sameMove(x.move, aBest));
    if (bIdx >= 0) {
      nullRegrets.push(b.candidates[b.bestIndex].q - b.candidates[bIdx].q);
    }

    // POSITIVE CONTROL: what does declining an available attack cost?
    if (c.hasAttack) {
      const passIdx = a.candidates.findIndex((x) => x.move.kind === "pass");
      const attackBest = a.candidates
        .filter((x) => x.move.kind === "attack")
        .reduce((best, x) => (best === null || x.q > best.q ? x : best), null as null | (typeof a.candidates)[number]);
      if (passIdx >= 0 && attackBest) {
        const passSamples = a.candidates[passIdx].samples;
        const paired = attackBest.samples.map((v, k) => v - passSamples[k]);
        const m = mean(paired);
        const se = sd(paired) / Math.sqrt(paired.length);
        controlN += 1;
        controlRegrets.push(m);
        if (se > 0 && m > 2 * se) controlSignificant += 1;
      }
    }
  }

  const elapsed = (Date.now() - t0) / 1000;
  console.log("NULL — regret the instrument assigns to its own best move");
  console.log(
    `  n=${nullRegrets.length}  mean ${pct(mean(nullRegrets))} pts  ` +
      `sd ${pct(sd(nullRegrets))}  max ${pct(Math.max(0, ...nullRegrets))}`,
  );
  console.log(
    `  => nothing below ~${pct(mean(nullRegrets) + sd(nullRegrets))} pts is a finding.\n`,
  );

  console.log("SELECTION BIAS — naive max-of-K vs split-sample");
  console.log(
    `  naive     mean ${pct(mean(naiveRegrets))} pts\n` +
      `  crossfit  mean ${pct(mean(crossRegrets))} pts\n` +
      `  bias      ${pct(mean(naiveRegrets) - mean(crossRegrets))} pts of pure selection\n`,
  );

  console.log("STABILITY — two independent runs on the same decision");
  console.log(
    `  same best move: ${stable}/${analyzed} = ${pct(analyzed ? stable / analyzed : 0)}%`,
  );
  console.log(`  mean spread across arms: ${pct(mean(spreads))} pts`);
  console.log(`  mean paired SE on a regret: ${pct(mean(pairedSes))} pts\n`);

  if (pilotMissing > 0) {
    console.log(
      `  !! ${pilotMissing} pilot moves were not found among their own legal ` +
        `candidates — move identity is broken, fix before reading further.\n`,
    );
  }
  console.log("DISCRIMINATION — mean regret of the move each policy would pick");
  console.log("  (known ordering: planner ~ heuristic << random < worst)");
  for (const key of ["heuristic", "pilot", "planner", "random", "worst"]) {
    const xs = rank[key];
    if (xs.length === 0) continue;
    const se = sd(xs) / Math.sqrt(xs.length);
    console.log(
      `  ${key.padEnd(10)} ${pct(mean(xs)).padStart(6)} pts  ±${pct(1.96 * se)}  n=${xs.length}`,
    );
  }
  {
    // Paired across decisions: the same rollouts price both arms, so this
    // difference is far better resolved than the two means suggest.
    const n = Math.min(rank.random.length, rank.heuristic.length);
    const diff = rank.random.slice(0, n).map((r, i) => r - rank.heuristic[i]);
    const se = sd(diff) / Math.sqrt(Math.max(1, diff.length));
    const z = se > 0 ? mean(diff) / se : 0;
    console.log(
      `  random - heuristic (paired): ${pct(mean(diff))} pts  z=${z.toFixed(2)}  ` +
        (z > 2
          ? "SEPARABLE — the instrument ranks play quality."
          : "NOT SEPARABLE — it cannot tell a good move from a random one."),
    );
  }
  console.log("");

  console.log("POSITIVE CONTROL — value of attacking over passing");
  if (controlN === 0) {
    console.log("  no decision offered both an attack and a pass — control did not run.");
  } else {
    console.log(
      `  n=${controlN}  mean ${pct(mean(controlRegrets))} pts  ` +
        `significant on ${controlSignificant}/${controlN} = ` +
        `${pct(controlSignificant / controlN)}%`,
    );
    console.log(
      mean(controlRegrets) > 0.02
        ? "  PASS — the instrument sees that declining an attack is costly."
        : "  FAIL — the instrument cannot price an attack. Do not use it yet.",
    );
  }

  console.log(
    `\n${elapsed.toFixed(1)}s total  ` +
      `(${(elapsed / Math.max(1, analyzed)).toFixed(2)}s per decision, x2 runs)`,
  );
}

main();
