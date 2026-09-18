// Is a coaching recommendation CORRECT? An independent oracle decides.
//
// THE TRAP THIS SCRIPT EXISTS TO AVOID. `regret` IS the output of a
// simulation: Q(best) - Q(chosen), produced by rolling the position forward
// with HeuristicPolicy pilots over determinized hidden information.
// Re-simulating with the same engine grades the model's own homework. It
// agrees with itself to within sampling noise, prints a confident number, and
// means nothing. Formally the recommendation is `argmax Q-hat`; re-estimating
// Q-hat and checking the argmax still agrees measures estimator VARIANCE, not
// validity. Every comparison below varies something the coach held fixed.
//
// THE ORACLE, and why each property is load-bearing:
//   horizon: null   play to a real terminal and score 1 / 0.5 / 0, so NO
//                   evaluator is consulted at all. A systematic error in
//                   value-gbm-v1 is therefore visible to this study rather
//                   than invisible to it.
//   perfect info    self-play positions, no determinization, so the oracle
//                   does not also pay the meta prior's approximation cost.
//   480 rollouts    resolves ~5 points; `DEFAULT_SEVERITY.inaccuracy` is
//                   ~9 points, so the budget resolves the effect in question.
//                   Anything under ~192 cannot.
//
// The oracle is not omniscient. It is "what actually happens when this game is
// played out, many times, from here" — the best available ground truth, and
// genuinely independent of the coach's estimator.
//
// WHAT THIS DOES NOT MEASURE.
//   * Whether the advice is TEACHABLE, comprehensible, or worth a player's
//     attention. That needs human raters, not an oracle.
//   * Real-log performance. These are self-play positions with no
//     reconstruction loss, so every rate here is an UPPER BOUND on what the
//     shipped coach achieves on an imported log (~53% coverage, weaker deck).
//   * Anything the oracle's own pilot cannot see. HeuristicPolicy
//     continuations undervalue a setup play whose payoff needs strong
//     follow-up — in the SAME direction as production, which makes agreement
//     optimistic rather than conservative.
//
// Usage:
//   npx tsx scripts/ml/coach_trust.ts [--games 12] [--decisions 200]
//     [--epsilon 0.35] [--oracle-rollouts 480] [--prod-rollouts 16]
//     [--horizon 6] [--seeds 1,2,3] [--artifact PATH] [--json out.json]

import fs from "node:fs";
import path from "node:path";

import {
  HeuristicPolicy,
  instantiateDeck,
  playGame,
  legalMoves,
  viewFor,
  buildGhostState,
  heuristicEvaluator,
  describeMove,
  mulberry32,
  hashSeed,
  promoteBest,
  type DecisionObservation,
  type DecisionPolicy,
  type PlayerView,
  type SimMove,
  type TurnContext,
  type StateEvaluator,
} from "@/lib/engine/sim";
import type { GameState } from "@/lib/engine/types";
import { loadBenchmarkDecks } from "@/lib/ml/benchmarkDecks";
import { createBoardEvaluator } from "@/lib/ml/botEvaluator";
import { seedOrLabel } from "@/lib/ml/features/guards";
import { DEFAULT_SEVERITY, type Severity } from "@/lib/ml/strategist/coachGame";
import { severityOf } from "@/lib/ml/strategist/calibrate";
import { determinizeOpponent, determinizeRng } from "@/lib/ml/strategist/determinize";
import { analyzeDecision, semanticMoveKey } from "@/lib/ml/strategist/regret";
import type { Actor } from "@/lib/ml/strategist/value";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
/** Exits on an unreadable flag. A silent default is how a four-config sweep of
 *  regret_calibration.ts once returned four byte-identical results. */
function numArg(flag: string, fallback: number): number {
  const raw = arg(flag);
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    console.error(`[coach-trust] ${flag} expects a number, got ${JSON.stringify(raw)}`);
    process.exit(1);
  }
  return n;
}

const DECKS_FILE =
  arg("--decks-file") ?? path.resolve(REPO_ROOT, "data/ml/benchmark-decks.json");
const GAMES = numArg("--games", 12);
const MAX_DECISIONS = numArg("--decisions", 200);
// Epsilon is swept, not fixed. A study run only at high epsilon measures
// precision on blunders no real player makes; 0.10 is closer to a human's
// error rate and 0.35 is a deliberately bad player. Precision is reported per
// band because the bands are different questions.
const EPSILONS = (arg("--epsilon") ?? "0.10,0.20,0.35").split(",").map((s) => {
  const n = Number(s.trim());
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    console.error(`[coach-trust] --epsilon expects 0..1 values, got ${JSON.stringify(s)}`);
    process.exit(1);
  }
  return n;
});
const ORACLE_ROLLOUTS = numArg("--oracle-rollouts", 480);
const PROD_ROLLOUTS = numArg("--prod-rollouts", 16);
const HORIZON = numArg("--horizon", 6);
const ARTIFACT = arg("--artifact");
const JSON_OUT = arg("--json");
/** Run the oracle's own calibration and stop. */
const CONTROLS_ONLY = process.argv.includes("--controls");
const CONTROL_N = numArg("--control-n", 30);
/** Run the ablation ladder and stop. */
const LADDER_ONLY = process.argv.includes("--ladder");
const LADDER_N = numArg("--ladder-n", 200);
/** Run the horizon sweep and stop, e.g. --horizon-sweep 6,12,20 */
const SWEEP_RAW = arg("--horizon-sweep");
const SWEEP_HORIZONS = SWEEP_RAW
  ? SWEEP_RAW.split(",").map((s) => {
      const n = Number(s.trim());
      if (!Number.isInteger(n) || n < 1) {
        console.error(`[coach-trust] --horizon-sweep expects whole plies, got ${JSON.stringify(s)}`);
        process.exit(1);
      }
      return n;
    })
  : null;
/** Sweep the rollout budget at a deeper horizon, e.g. --rollout-sweep 16,32,64,128 */
const ROLLOUT_SWEEP_RAW = arg("--rollout-sweep");
const ROLLOUT_BUDGETS = ROLLOUT_SWEEP_RAW
  ? ROLLOUT_SWEEP_RAW.split(",").map((s) => {
      const n = Number(s.trim());
      if (!Number.isInteger(n) || n < 1) {
        console.error(`[coach-trust] --rollout-sweep expects whole counts, got ${JSON.stringify(s)}`);
        process.exit(1);
      }
      return n;
    })
  : null;
const DEEP_HORIZON = numArg("--deep-horizon", 12);
// Multi-seed by default. Every single-seed reading this project has taken has
// been wrong — strategist_duel.ts carries the list.
const SEEDS = (arg("--seeds") ?? "1,2,3")
  .split(",")
  .map((s) => seedOrLabel(s.trim(), 1, hashSeed));

/* ─── The player being graded ───────────────────────────────────── */

/** Epsilon chance of a uniform-random legal move, else the heuristic.
 *
 *  The captured player must NOT be the rollout pilot. A smoke run with
 *  HeuristicPolicy on both sides surfaced ZERO recommendations in 12
 *  decisions: the coach was grading a player whose policy was identical to its
 *  own pilot, so it found nothing to say. Epsilon is the dial that sets how
 *  many genuine mistakes exist to be caught, which is why precision is
 *  reported PER EPSILON BAND — a study run only at high epsilon measures
 *  precision on blunders no real player makes.
 *
 *  Promotion delegates to the heuristic so the noisy side is not additionally
 *  handicapped after a KO; skill_ladder.ts's RandomPolicy does the same. */
class NoisyPolicy implements DecisionPolicy {
  private readonly rng: () => number;
  private readonly base = new HeuristicPolicy();
  constructor(
    seedValue: number,
    private readonly epsilon: number,
  ) {
    this.rng = mulberry32(seedValue >>> 0);
  }
  chooseMove(view: PlayerView, legal: SimMove[], ctx: TurnContext): SimMove {
    if (legal.length === 0) return { kind: "pass" };
    if (this.rng() < this.epsilon) return legal[Math.floor(this.rng() * legal.length)];
    return this.base.chooseMove(view, legal, ctx);
  }
  choosePromotion(view: PlayerView): number {
    return promoteBest(view.board.bench);
  }
}

/* ─── Corpus ────────────────────────────────────────────────────── */

interface Captured {
  gameId: string;
  epsilon: number;
  state: GameState;
  actor: "player";
  ctx: TurnContext;
  move: SimMove;
  legal: SimMove[];
  turn: number;
}

/** The noisy side always holds the "player" seat; initiative alternates, so
 *  who moves first can never alias with which side is being graded. */
function collect(seed: number, epsilon: number): Captured[] {
  const decks = loadBenchmarkDecks(DECKS_FILE);
  const out: Captured[] = [];
  for (let g = 0; g < GAMES; g++) {
    const deck = instantiateDeck(decks[g % decks.length].list);
    const gameSeed = hashSeed(`coach-trust:${seed}:collect:${g}`);
    const gameId = `${seed}:${epsilon}:${g}`;
    const onDecision = (ev: DecisionObservation) => {
      if (ev.actor !== "player") return;
      if (ev.legal.length < 2) return;
      out.push({
        gameId,
        epsilon,
        // The driver hands over its live state by contract; keeping it means
        // cloning it.
        state: structuredClone(ev.state),
        actor: "player",
        ctx: { ...ev.ctx },
        move: ev.move,
        legal: ev.legal.map((m) => structuredClone(m)),
        turn: ev.state.turn.number,
      });
    };
    playGame(
      deck,
      deck,
      {
        player: new NoisyPolicy(hashSeed(`coach-trust:${seed}:noise:${g}`), epsilon),
        opponent: new HeuristicPolicy(),
      },
      mulberry32(gameSeed),
      g % 2 === 0 ? "player" : "opponent",
      { onDecision },
    );
  }
  return out;
}

function sample<T>(xs: T[], n: number, seed: number): T[] {
  if (xs.length <= n) return xs;
  const rng = mulberry32(seed >>> 0);
  const idx = xs.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx
    .slice(0, n)
    .sort((a, b) => a - b)
    .map((i) => xs[i]);
}

/* ─── Arms ──────────────────────────────────────────────────────── */

type Verdict = "CONFIRMED" | "CONTRADICTED" | "unresolved" | "outcome-equivalent";

interface Item {
  gameId: string;
  epsilon: number;
  turn: number;
  playedKind: string;
  suggestedKind: string;
  played: string;
  suggested: string;
  legalCount: number;
  ghostLegalCount: number;
  stakes: number;
  regret: number;
  regretSe: number;
  severity: Severity;
  capture: number | null;
  oracleDelta: number;
  oracleSe: number;
  /** The PLAYED arm's absolute win rate under the oracle. Separates "these
   *  two moves are genuinely equivalent" from "this position was already
   *  decided and nothing either player does here matters". */
  oracleQ: number;
  /** PRODUCTION's own estimate of the same thing. The oracle is what decides
   *  whether advice was moot, and it costs 480 rollouts played to a terminal —
   *  far beyond a request. If this cheap number predicts the expensive one,
   *  the shipped coach can suppress moot advice without paying for an oracle,
   *  which is the whole difference between a measurable finding and a
   *  shippable rule. */
  prodQ: number;
  verdict: Verdict;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}
function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1));
}
const pts = (x: number) => (100 * x).toFixed(1);

function findSemantic(moves: SimMove[], target: SimMove): SimMove | null {
  const k = semanticMoveKey(target);
  return moves.find((m) => semanticMoveKey(m) === k) ?? null;
}

interface Fidelity {
  /** Decisions whose played move had no counterpart in the ghost. */
  unrepresentable: number;
  /** ghostLegal - trueLegal, per decision. */
  legalDelta: number[];
}

/**
 * The PRODUCTION arm: exactly what the shipped coach does to a log position —
 * redact to what the player can see, determinize the opponent from the meta
 * prior, short horizon, small budget, value-gbm-v1 at the leaf.
 *
 * Returns the recommendation it would surface, or null when it would stay
 * quiet. The surfacing rule mirrors the app: significant, and severity above
 * "ok". Nothing reaches a user without clearing its own error bar.
 */
function production(
  d: Captured,
  evaluate: StateEvaluator,
  seed: number,
  fid: Fidelity,
): {
  suggestedGhost: SimMove;
  regret: number;
  regretSe: number;
  severity: Severity;
  stakes: number;
  capture: number | null;
  qChosen: number;
  ghostLegalCount: number;
} | null {
  const view = viewFor(d.state, d.actor, d.ctx);
  const ghost = buildGhostState(view);
  const ghostCtx = { ...d.ctx };
  const ghostLegal = legalMoves(ghost, "player", ghostCtx);
  fid.legalDelta.push(ghostLegal.length - d.legal.length);

  // Move identity does not survive the true/ghost boundary: the ghost's deck
  // carries synthetic ids, so moveKey cannot match. semanticMoveKey is the
  // name-based key SearchPolicy uses for the same reason.
  const chosenGhost = findSemantic(ghostLegal, d.move);
  if (!chosenGhost) {
    fid.unrepresentable += 1;
    return null;
  }

  const decisionSeed = hashSeed(`coach-trust:${seed}:prod:${d.gameId}:${d.turn}`);
  const a = analyzeDecision(ghost, "player", ghostCtx, chosenGhost, {
    rollouts: PROD_ROLLOUTS,
    horizon: HORIZON,
    evaluate,
    seed: decisionSeed,
    // `prepare` MUST be a pure function of the rollout index. If
    // determinization varied per ARM, common random numbers would break and
    // every paired error bar would be a lie.
    prepare: (clone, r) => {
      determinizeOpponent(clone, view, determinizeRng(decisionSeed, r));
    },
  });
  if (!a || a.regret === null || a.alternativeIndex === null) return null;
  if (!a.significant) return null;

  const severity = severityOf(a.regret, DEFAULT_SEVERITY);
  if (severity === "ok") return null;

  const qs = a.candidates.map((c) => c.q);
  const best = Math.max(...qs);
  const worst = Math.min(...qs);
  const stakes = best - worst;
  const chosenIdx = a.chosenIndex;
  const capture =
    stakes > 0 && chosenIdx !== null ? (a.candidates[chosenIdx].q - worst) / stakes : null;

  return {
    suggestedGhost: a.candidates[a.alternativeIndex].move,
    regret: a.regret,
    regretSe: a.regretSe,
    severity,
    stakes,
    capture,
    qChosen: chosenIdx !== null ? a.candidates[chosenIdx].q : 0.5,
    ghostLegalCount: ghostLegal.length,
  };
}

interface PairResult {
  delta: number;
  se: number;
  q: number;
  verdict: Verdict;
}

/**
 * The 2-arm paired comparison, on whatever state and settings it is handed.
 *
 * Every rung of the ablation ladder goes through here, INCLUDING the oracle,
 * so a difference between two rungs can only come from the settings and never
 * from two implementations drifting apart. Same argument that pulled
 * logDecisions.ts out of move_agreement.ts.
 */
function pairedVerdict(
  state: GameState,
  actor: Actor,
  ctx: TurnContext,
  played: SimMove,
  alt: SimMove,
  cfg: { rollouts: number; horizon: number | null; evaluate: StateEvaluator | null },
  seed: number,
  prepare?: (clone: GameState, r: number) => void,
): PairResult | null {
  const playedKey = semanticMoveKey(played);
  const sugKey = semanticMoveKey(alt);
  if (playedKey === sugKey) return null;
  const want = new Set([playedKey, sugKey]);
  // Dedupe by semantic key so the table is exactly two arms even when the
  // hand holds two copies of the same card.
  const seen = new Set<string>();

  const a = analyzeDecision(state, actor, ctx, played, {
    rollouts: cfg.rollouts,
    horizon: cfg.horizon,
    evaluate: cfg.evaluate,
    seed,
    candidateFilter: (m) => {
      const k = semanticMoveKey(m);
      if (!want.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    },
    prepare,
  });
  if (!a) return null;
  const iPlayed = a.candidates.findIndex((c) => semanticMoveKey(c.move) === playedKey);
  const iSug = a.candidates.findIndex((c) => semanticMoveKey(c.move) === sugKey);
  if (iPlayed < 0 || iSug < 0) return null;

  // Paired on common random numbers: `samples` is index-aligned across arms,
  // so rollout k of both arms shares a seed and the difference resolves far
  // better than two independent means would.
  const paired = a.candidates[iSug].samples.map((v, k) => v - a.candidates[iPlayed].samples[k]);
  const m = mean(paired);
  const se = sd(paired) / Math.sqrt(paired.length);

  // Report `unresolved` as its own class, never folded into either side. And
  // give the arms-are-outcome-identical case its own bucket: production
  // flagged a decision where the moves provably do not matter, which is a
  // distinct and interesting failure mode from "we could not tell".
  let verdict: Verdict;
  if (paired.every((v) => v === 0)) verdict = "outcome-equivalent";
  else if (se === 0) verdict = m > 0 ? "CONFIRMED" : "CONTRADICTED";
  else if (m > 2 * se) verdict = "CONFIRMED";
  else if (m < -2 * se) verdict = "CONTRADICTED";
  else verdict = "unresolved";

  return { delta: m, se, q: a.candidates[iPlayed].q, verdict };
}

/**
 * The ORACLE arm: perfect information, played to a real terminal, no evaluator
 * consulted at all. "Is this recommendation worth surfacing" does not need a
 * full Q table — only "does the suggested move actually beat the played one" —
 * and cost is linear in arms, so 2-arm is ~7x cheaper than the full table.
 */
function oracle(
  d: Captured,
  suggestedTrue: SimMove,
  seed: number,
  opts: { played?: SimMove; label?: string } = {},
): PairResult | null {
  return pairedVerdict(
    d.state,
    d.actor,
    d.ctx,
    opts.played ?? d.move,
    suggestedTrue,
    { rollouts: ORACLE_ROLLOUTS, horizon: null, evaluate: null },
    hashSeed(`coach-trust:${seed}:oracle${opts.label ?? ""}:${d.gameId}:${d.turn}`),
  );
}

/* ─── The ablation ladder ───────────────────────────────────────── */

/**
 * Production differs from the oracle on three axes. Walking them ONE AT A TIME
 * attributes the error instead of merely measuring it, which is what turns
 * "the coach is 80% right" into a work queue.
 *
 * The spec's table lists five rows, but its last two (`+ budget` and
 * `production`) are the identical configuration — ghost, horizon 6, 16
 * rollouts — so there are four distinct rungs and three steps between them.
 */
interface Rung {
  name: string;
  ghost: boolean;
  horizon: number | null;
  rollouts: number;
  /** null = no evaluator (play to a terminal); otherwise which one. */
  evaluator: "none" | "heuristic" | "model";
  /** What the step from the PREVIOUS rung isolates. */
  isolates: string;
}

function ladderRungs(): Rung[] {
  return [
    {
      name: `oracle       perfect, to end,  none, ${ORACLE_ROLLOUTS}`,
      ghost: false,
      horizon: null,
      rollouts: ORACLE_ROLLOUTS,
      evaluator: "none",
      isolates: "",
    },
    // The spec's ladder jumps straight from "play to a terminal" to
    // "horizon 6 + value-gbm-v1", which moves TWO things at once — and they
    // cannot be separated by omission, because a finite horizon with no
    // evaluator throws by design. Splitting the step with the planner's
    // built-in `heuristicEvaluator` (a clamped prize/bench/hand score, no
    // learned model) separates them properly, and answers a question nothing
    // has asked: what is the value model worth TO THE COACH? It is measured
    // at +4.5 pts inside the planner and has never been priced here.
    {
      name: `+truncation  perfect, h${HORIZON},      heur, ${ORACLE_ROLLOUTS}`,
      ghost: false,
      horizon: HORIZON,
      rollouts: ORACLE_ROLLOUTS,
      evaluator: "heuristic",
      isolates: "stopping at the horizon (scored WITHOUT the learned model)",
    },
    {
      name: `+model       perfect, h${HORIZON},     model, ${ORACLE_ROLLOUTS}`,
      ghost: false,
      horizon: HORIZON,
      rollouts: ORACLE_ROLLOUTS,
      evaluator: "model",
      isolates: "swapping the heuristic leaf for value-gbm-v1",
    },
    {
      name: `+ghost       determinized, h${HORIZON}, model, ${ORACLE_ROLLOUTS}`,
      ghost: true,
      horizon: HORIZON,
      rollouts: ORACLE_ROLLOUTS,
      evaluator: "model",
      isolates: "hidden information (redaction + meta prior)",
    },
    {
      name: `production   determinized, h${HORIZON}, model,  ${PROD_ROLLOUTS}`,
      ghost: true,
      horizon: HORIZON,
      rollouts: PROD_ROLLOUTS,
      evaluator: "model",
      isolates: "the rollout budget",
    },
  ];
}

/** One rung, on one decision's (played, suggested) pair. */
function runRung(
  d: Captured,
  playedTrue: SimMove,
  altTrue: SimMove,
  rung: Rung,
  evaluate: StateEvaluator,
  seed: number,
): PairResult | null {
  const cfg = {
    rollouts: rung.rollouts,
    horizon: rung.horizon,
    evaluate:
      rung.evaluator === "none"
        ? null
        : rung.evaluator === "heuristic"
          ? heuristicEvaluator
          : evaluate,
  };
  const s = hashSeed(`coach-trust:${seed}:rung:${rung.name}:${d.gameId}:${d.turn}`);
  if (!rung.ghost) {
    return pairedVerdict(d.state, d.actor, d.ctx, playedTrue, altTrue, cfg, s);
  }
  // Redact to what the player can see, then determinize per rollout. Move
  // identity does not survive the boundary, so both arms are re-found by name.
  const view = viewFor(d.state, d.actor, d.ctx);
  const ghost = buildGhostState(view);
  const ghostCtx = { ...d.ctx };
  const ghostLegal = legalMoves(ghost, "player", ghostCtx);
  const playedG = findSemantic(ghostLegal, playedTrue);
  const altG = findSemantic(ghostLegal, altTrue);
  if (!playedG || !altG) return null;
  return pairedVerdict(ghost, "player", ghostCtx, playedG, altG, cfg, s, (clone, r) => {
    determinizeOpponent(clone, view, determinizeRng(s, r));
  });
}

/* ─── Report ────────────────────────────────────────────────────── */

function rate(items: Item[]): string {
  if (items.length === 0) return "   n=0";
  const c = items.filter((i) => i.verdict === "CONFIRMED").length;
  const x = items.filter((i) => i.verdict === "CONTRADICTED").length;
  const u = items.filter((i) => i.verdict === "unresolved").length;
  const e = items.filter((i) => i.verdict === "outcome-equivalent").length;
  const decided = c + x;
  const prec = decided > 0 ? `${((100 * c) / decided).toFixed(0)}%` : "  — ";
  return (
    `n=${String(items.length).padStart(4)}  ` +
    `confirmed ${String(c).padStart(3)}  contradicted ${String(x).padStart(3)}  ` +
    `unresolved ${String(u).padStart(3)}  equiv ${String(e).padStart(3)}  ` +
    `precision ${prec}`
  );
}

function bucketBy<T>(items: Item[], key: (i: Item) => T): Map<T, Item[]> {
  const m = new Map<T, Item[]>();
  for (const i of items) {
    const k = key(i);
    const cell = m.get(k) ?? [];
    cell.push(i);
    m.set(k, cell);
  }
  return m;
}

function section(title: string, items: Item[], key: (i: Item) => string): void {
  console.log(`\n${title}`);
  const buckets = Array.from(bucketBy(items, key)).sort((a, b) => b[1].length - a[1].length);
  for (const [k, xs] of buckets) {
    console.log(`  ${k.slice(0, 20).padEnd(22)}${rate(xs)}`);
  }
}

/**
 * Calibrate the oracle before believing it.
 *
 * POSITIVE CONTROL — declining an available attack must price as a large,
 * significant loss. An oracle that cannot see that is not measuring play
 * quality, and in particular every `outcome-equivalent` verdict it returns
 * would be suspect: a degenerate oracle that always reports "these moves are
 * the same" produces exactly that bucket.
 *
 * STABILITY — the same arm pair, re-run on an INDEPENDENT seed. The two
 * deltas should agree inside their own error bars. This is the check that the
 * pairing is not manufacturing a difference; comparing an arm against itself
 * under common random numbers is degenerate (identically zero by
 * construction) and would prove nothing.
 */
function controls(seeds: number[]): void {
  // Pooled across seeds. A per-seed control at n=40 reads z~1.8 on an effect
  // this size and would be recorded as a FAIL for want of power — the same
  // single-reading mistake this project has made five times.
  const chosen: Captured[] = [];
  let offered = 0;
  for (const seed of seeds) {
    const withAttack = collect(seed, 0.35).filter(
      (d) => d.legal.some((m) => m.kind === "attack") && d.legal.some((m) => m.kind === "pass"),
    );
    offered += withAttack.length;
    for (const d of sample(withAttack, CONTROL_N, hashSeed(`coach-trust:${seed}:control`))) {
      chosen.push(d);
    }
  }

  console.log(
    `\nPOSITIVE CONTROL — is declining an available attack priced as a loss?` +
      `\n  ${offered} positions offer both an attack and a pass; ${chosen.length} sampled ` +
      `across ${seeds.length} seed(s)`,
  );
  const gains: number[] = [];
  const live: number[] = [];
  let significant = 0;
  let equivalent = 0;
  const pairs: { a: number; b: number; se: number }[] = [];
  for (const d of chosen) {
    const attack = d.legal.find((m) => m.kind === "attack")!;
    const pass = d.legal.find((m) => m.kind === "pass")!;
    const seed = hashSeed(d.gameId);
    const o = oracle(d, attack, seed, { played: pass, label: ":posctl" });
    if (!o) continue;
    gains.push(o.delta);
    if (o.verdict === "CONFIRMED") significant += 1;
    if (o.verdict === "outcome-equivalent") equivalent += 1;
    // A position whose outcome is already settled cannot show that attacking
    // is better, because nothing can. Reported separately rather than dropped:
    // the dilution is a property of the corpus, not a nuisance to hide.
    else live.push(o.delta);
    if (pairs.length < 15) {
      const o2 = oracle(d, attack, seed + 7919, { played: pass, label: ":stab2" });
      if (o2) pairs.push({ a: o.delta, b: o2.delta, se: Math.hypot(o.se, o2.se) });
    }
  }

  const verdict = (m: number, se: number) => {
    const z = se > 0 ? m / se : 0;
    return (
      `${pts(m)} pts (±${pts(1.96 * se)})  z=${z.toFixed(2)}  ` +
      (z > 1.96
        ? "PASS — the oracle can see play quality."
        : z < -1.96
          ? "FAIL IN THE WRONG DIRECTION — passing beats attacking. Trust nothing."
          : "FAIL — cannot resolve the single clearest mistake in the game.")
    );
  };

  if (gains.length < 3) {
    console.log("  too few resolvable positions — raise --games.");
  } else {
    console.log(
      `  all positions   n=${gains.length}  ${verdict(mean(gains), sd(gains) / Math.sqrt(gains.length))}\n` +
        `  ${significant} individually significant, ${equivalent} outcome-equivalent ` +
        `(${((100 * equivalent) / gains.length).toFixed(0)}% of the control is already-decided games)`,
    );
    if (live.length >= 3) {
      console.log(
        `  live positions  n=${live.length}  ${verdict(mean(live), sd(live) / Math.sqrt(live.length))}`,
      );
    }
  }

  console.log(`\nSTABILITY — same arms, independent seed`);
  if (pairs.length < 3) {
    console.log("  too few pairs.");
  } else {
    const within = pairs.filter((p) => Math.abs(p.a - p.b) <= 2 * p.se).length;
    console.log(
      `  mean |difference| between runs ` +
        `${pts(mean(pairs.map((p) => Math.abs(p.a - p.b))))} pts over n=${pairs.length}\n` +
        `  ${within}/${pairs.length} agree inside their own 2-sigma bar  ` +
        (within >= Math.ceil(0.8 * pairs.length)
          ? "PASS"
          : "SUSPECT — the bars understate the true run-to-run spread."),
    );
  }
}

/**
 * THE ABLATION LADDER. Production differs from the oracle on three axes;
 * walking them one at a time says which one costs what.
 *
 * Every rung is scored on the SAME recommendations, so the comparison is
 * paired and a rung's disagreement cannot be a different sample.
 */
interface LadderCase {
  d: Captured;
  played: SimMove;
  alt: SimMove;
}

/**
 * The cases are whatever PRODUCTION surfaces at its shipped settings. That is
 * deliberate and it is what makes the ladder and the horizon sweep answerable:
 * the question is never "what would a different coach flag" but "of the things
 * the shipped coach says today, which are right, and what would fix the rest".
 */
function collectCases(evaluate: StateEvaluator, label: string): LadderCase[] {
  const cases: LadderCase[] = [];
  for (const seed of SEEDS) {
    for (const eps of EPSILONS) {
      if (cases.length >= LADDER_N) break;
      const all = collect(seed, eps);
      const fid: Fidelity = { unrepresentable: 0, legalDelta: [] };
      for (const d of sample(all, MAX_DECISIONS, hashSeed(`coach-trust:${seed}:sample`))) {
        if (cases.length >= LADDER_N) break;
        const p = production(d, evaluate, seed, fid);
        if (!p) continue;
        const altTrue = findSemantic(d.legal, p.suggestedGhost);
        if (!altTrue) continue;
        cases.push({ d, played: d.move, alt: altTrue });
      }
      console.log(
        `[coach-trust] ${label} corpus: ${cases.length}/${LADDER_N} cases ` +
          `(seed ${seed}, eps ${eps})`,
      );
    }
  }
  return cases;
}

/**
 * THE HORIZON SWEEP. The ladder says truncation is the dominant error and the
 * value model recovers part of it. Depth and leaf quality are SUBSTITUTES —
 * a perfect leaf at h=6 is the oracle, and so is an unbounded horizon with no
 * leaf at all — so the 15 remaining points can be bought either way, at very
 * different prices. Depth costs compute on every request forever and adds
 * variance; a better leaf costs one training run and is free at inference.
 *
 * This decides which to fund. If depth recovers most of the gap, the tree
 * trainer is unnecessary. If it barely moves, the leaf is binding and the
 * trainer is justified.
 *
 * The cases are held FIXED at what production surfaces today; only the horizon
 * used to evaluate them varies. Varying the horizon that also selects the
 * cases would change the question between arms.
 */
function horizonSweep(evaluate: StateEvaluator, horizons: number[]): void {
  const cases = collectCases(evaluate, "sweep");
  const oracleRes = cases.map((c) => oracle(c.d, c.alt, SEEDS[0]));
  const scorable = oracleRes
    .map((o, i) => ({ o, i }))
    .filter((x) => x.o && (x.o.verdict === "CONFIRMED" || x.o.verdict === "CONTRADICTED"));

  console.log(
    `\nHORIZON SWEEP — ${cases.length} recommendations, ${scorable.length} the oracle resolved\n` +
      `Cases fixed at production's own settings; only the evaluating horizon moves.\n`,
  );

  // Two arms per horizon: the clean one (perfect information, full budget)
  // isolates depth itself, and the production-shaped one says what a shipped
  // coach would actually get for the extra compute.
  for (const mode of [
    `perfect info, ${ORACLE_ROLLOUTS} rollouts — isolates depth itself`,
    `determinized, ${PROD_ROLLOUTS} rollouts — what a shipped coach would get`,
  ]) {
    const ghost = mode.startsWith("determinized");
    const rollouts = ghost ? PROD_ROLLOUTS : ORACLE_ROLLOUTS;
    console.log(`  ${mode}`);
    const flagsByH: boolean[][] = [];
    for (const h of horizons) {
      const rung: Rung = {
        name: `h${h}`,
        ghost,
        horizon: h,
        rollouts,
        evaluator: "model",
        isolates: "",
      };
      const res = scorable.map((x) =>
        runRung(cases[x.i].d, cases[x.i].played, cases[x.i].alt, rung, evaluate, SEEDS[0]),
      );
      const ran = res.filter((v) => v !== null);
      const flags = res.map((v, k) => v !== null && v.verdict === scorable[k].o!.verdict);
      flagsByH.push(flags);
      const agree = ran.length > 0 ? flags.filter(Boolean).length / ran.length : 0;
      const sign =
        ran.length > 0
          ? res.filter((v, k) => v !== null && Math.sign(v.delta) === Math.sign(scorable[k].o!.delta))
              .length / ran.length
          : 0;
      console.log(
        `    horizon ${String(h).padStart(2)}   agree ${(100 * agree).toFixed(0).padStart(3)}%   ` +
          `sign ${(100 * sign).toFixed(0).padStart(3)}%   ran ${String(ran.length).padStart(3)}`,
      );
    }
    // Paired across horizons, same cases: McNemar against the shallowest.
    for (let k = 1; k < horizons.length; k++) {
      let lost = 0;
      let gained = 0;
      for (let i = 0; i < flagsByH[0].length; i++) {
        if (flagsByH[0][i] && !flagsByH[k][i]) lost += 1;
        else if (!flagsByH[0][i] && flagsByH[k][i]) gained += 1;
      }
      const n = lost + gained;
      const z = n > 0 ? (gained - lost) / Math.sqrt(n) : 0;
      console.log(
        `      h${horizons[0]} -> h${horizons[k]}:  lost ${String(lost).padStart(3)}  ` +
          `gained ${String(gained).padStart(3)}  discordant ${String(n).padStart(3)}  ` +
          `z=${z.toFixed(2)}  ` +
          (Math.abs(z) > 1.96
            ? z > 0
              ? "SEPARABLE — depth buys agreement."
              : "SEPARABLE IN THE WRONG DIRECTION — deeper is worse."
            : "NOT SEPARABLE — depth is not the lever."),
      );
    }
    console.log("");
  }
}

/**
 * THE ROLLOUT SWEEP. The horizon sweep found that depth works at 480 rollouts
 * (82% -> 94%) and BACKFIRES at production's 16 (77% -> 54%), because each
 * extra ply adds variance the budget cannot absorb and verdicts decay into
 * `unresolved`. Depth and samples are therefore complements, bought
 * multiplicatively.
 *
 * This finds the crossover: the smallest budget at which the deeper search
 * actually beats the shallow incumbent. Every arm is compared against the
 * SHIPPED configuration (h6 at 16 rollouts), because "better than what we run
 * today" is the only comparison that decides anything.
 */
function rolloutSweep(evaluate: StateEvaluator, budgets: number[], deepH: number): void {
  const cases = collectCases(evaluate, "rollout-sweep");
  const oracleRes = cases.map((c) => oracle(c.d, c.alt, SEEDS[0]));
  const scorable = oracleRes
    .map((o, i) => ({ o, i }))
    .filter((x) => x.o && (x.o.verdict === "CONFIRMED" || x.o.verdict === "CONTRADICTED"));

  console.log(
    `\nROLLOUT SWEEP — ${cases.length} recommendations, ${scorable.length} the oracle resolved\n` +
      `Deeper search at h${deepH}, swept over budget, against the shipped h${HORIZON}/${PROD_ROLLOUTS}.\n`,
  );

  const armFlags = (rung: Rung) => {
    const res = scorable.map((x) =>
      runRung(cases[x.i].d, cases[x.i].played, cases[x.i].alt, rung, evaluate, SEEDS[0]),
    );
    const ran = res.filter((v) => v !== null);
    const flags = res.map((v, k) => v !== null && v.verdict === scorable[k].o!.verdict);
    const sign = res.filter(
      (v, k) => v !== null && Math.sign(v.delta) === Math.sign(scorable[k].o!.delta),
    ).length;
    return { flags, ran: ran.length, sign: ran.length > 0 ? sign / ran.length : 0 };
  };

  const base = armFlags({
    name: "incumbent",
    ghost: true,
    horizon: HORIZON,
    rollouts: PROD_ROLLOUTS,
    evaluator: "model",
    isolates: "",
  });
  const baseAgree = base.ran > 0 ? base.flags.filter(Boolean).length / base.ran : 0;
  console.log(
    `  INCUMBENT  h${HORIZON} @ ${String(PROD_ROLLOUTS).padStart(3)} rollouts   ` +
      `agree ${(100 * baseAgree).toFixed(0).padStart(3)}%   sign ${(100 * base.sign).toFixed(0).padStart(3)}%   ` +
      `ran ${base.ran}`,
  );
  console.log(`  ---`);

  for (const r of budgets) {
    const arm = armFlags({
      name: `h${deepH}@${r}`,
      ghost: true,
      horizon: deepH,
      rollouts: r,
      evaluator: "model",
      isolates: "",
    });
    const agree = arm.ran > 0 ? arm.flags.filter(Boolean).length / arm.ran : 0;
    let lost = 0;
    let gained = 0;
    for (let i = 0; i < base.flags.length; i++) {
      if (base.flags[i] && !arm.flags[i]) lost += 1;
      else if (!base.flags[i] && arm.flags[i]) gained += 1;
    }
    const n = lost + gained;
    const z = n > 0 ? (gained - lost) / Math.sqrt(n) : 0;
    console.log(
      `  h${deepH} @ ${String(r).padStart(3)} rollouts  (${(r / PROD_ROLLOUTS).toFixed(1)}x compute)  ` +
        `agree ${(100 * agree).toFixed(0).padStart(3)}%   sign ${(100 * arm.sign).toFixed(0).padStart(3)}%\n` +
        `      vs incumbent: lost ${String(lost).padStart(3)}  gained ${String(gained).padStart(3)}  ` +
        `discordant ${String(n).padStart(3)}  z=${z.toFixed(2)}  ` +
        (Math.abs(z) > 1.96
          ? z > 0
            ? "SEPARABLE — worth the compute."
            : "SEPARABLE IN THE WRONG DIRECTION — still under-sampled."
          : "NOT SEPARABLE — no better than today."),
    );
  }
  console.log(
    `\n  The crossover is the smallest budget whose z turns positive. Below it,\n` +
      `  the extra depth is bias reduction the sample count cannot resolve.`,
  );
}

function ladderStudy(evaluate: StateEvaluator): void {
  const rungs = ladderRungs();
  const cases = collectCases(evaluate, "ladder");

  // rung index -> result per case (null where the rung could not run)
  const results: (PairResult | null)[][] = rungs.map(() => []);
  for (const c of cases) {
    for (let r = 0; r < rungs.length; r++) {
      results[r].push(runRung(c.d, c.played, c.alt, rungs[r], evaluate, SEEDS[0]));
    }
  }

  const oracleRes = results[0];
  // The ladder is scored against what the ORACLE resolved. An item the oracle
  // could not call is not a yardstick for anything.
  const scorable = oracleRes
    .map((o, i) => ({ o, i }))
    .filter((x) => x.o && (x.o.verdict === "CONFIRMED" || x.o.verdict === "CONTRADICTED"));

  console.log(
    `\nABLATION LADDER — ${cases.length} recommendations, ` +
      `${scorable.length} the oracle resolved\n` +
      `Each rung changes ONE thing from the rung above it.\n`,
  );
  console.log(
    `rung                                 agree  sign   ran   step isolates`,
  );

  // Per-rung agreement flags, kept so adjacent rungs can be compared PAIRED.
  const agreeFlags: boolean[][] = [];
  let prevAgree: number | null = null;
  for (let r = 0; r < rungs.length; r++) {
    const rows = scorable.map((x) => ({ o: x.o!, v: results[r][x.i] }));
    const ran = rows.filter((x) => x.v !== null);
    agreeFlags.push(rows.map((x) => x.v !== null && x.v.verdict === x.o.verdict));
    if (ran.length === 0) {
      console.log(`  ${rungs[r].name}   — could not run`);
      continue;
    }
    const sameVerdict = ran.filter((x) => x.v!.verdict === x.o.verdict).length;
    const sameSign = ran.filter((x) => Math.sign(x.v!.delta) === Math.sign(x.o.delta)).length;
    const agree = sameVerdict / ran.length;
    const sign = sameSign / ran.length;
    const step =
      prevAgree === null
        ? ""
        : `${((agree - prevAgree) * 100).toFixed(1).padStart(6)} pts  ${rungs[r].isolates}`;
    console.log(
      `  ${rungs[r].name}  ${(100 * agree).toFixed(0).padStart(4)}%  ` +
        `${(100 * sign).toFixed(0).padStart(4)}%  ${String(ran.length).padStart(4)}  ${step}`,
    );
    prevAgree = agree;
  }

  // McNemar on adjacent rungs. A step is measured on the SAME cases, so the
  // paired test is the right one and the marginal difference printed above is
  // not — it carries no error bar, and reporting a step size without one is
  // how this project has been fooled repeatedly. Only the DISCORDANT cases
  // carry information about a paired difference.
  console.log(`\nIS EACH STEP REAL? McNemar on the discordant cases`);
  for (let r = 1; r < rungs.length; r++) {
    const a = agreeFlags[r - 1];
    const b = agreeFlags[r];
    let lost = 0; // agreed before, not after
    let gained = 0; // not before, agreed after
    for (let i = 0; i < a.length; i++) {
      if (a[i] && !b[i]) lost += 1;
      else if (!a[i] && b[i]) gained += 1;
    }
    const n = lost + gained;
    const z = n > 0 ? (gained - lost) / Math.sqrt(n) : 0;
    console.log(
      `  ${rungs[r].name}\n` +
        `      lost ${String(lost).padStart(3)}  gained ${String(gained).padStart(3)}  ` +
        `discordant ${String(n).padStart(3)}  z=${z.toFixed(2)}  ` +
        (Math.abs(z) > 1.96
          ? z < 0
            ? "SEPARABLE — this step really does cost agreement."
            : "SEPARABLE — this step really does buy agreement."
          : "NOT SEPARABLE at this n."),
    );
  }

  console.log(
    `\n  "agree" = same verdict as the oracle; "sign" = same DIRECTION, which\n` +
      `  is the more forgiving read and the one that matters for advice —\n` +
      `  a rung that picks the right move with a wider bar is still useful.`,
  );

  // Where the ladder cannot even run is itself an attribution: the ghost
  // rungs drop any case whose moves it cannot represent.
  for (let r = 0; r < rungs.length; r++) {
    const missing = scorable.filter((x) => results[r][x.i] === null).length;
    if (missing > 0) {
      console.log(
        `  ${rungs[r].name}: ${missing} of ${scorable.length} cases unrunnable ` +
          `(the ghost could not represent both arms)`,
      );
    }
  }
}

function main(): void {
  const evaluate = createBoardEvaluator(ARTIFACT ?? undefined);
  // Refuse to run degraded. A silent fallback here would compare two different
  // stacks and report the difference as a finding.
  if (!evaluate) {
    console.error(
      "[coach-trust] no value artifact — the production arm cannot be built. " +
        "Pass --artifact PATH or make one live.",
    );
    process.exit(1);
  }

  console.log(
    `[coach-trust] seeds ${SEEDS.join(",")}  games/seed ${GAMES}  epsilon ${EPSILONS.join(",")}\n` +
      `[coach-trust] oracle ${ORACLE_ROLLOUTS} rollouts to game end, no evaluator\n` +
      `[coach-trust] production ${PROD_ROLLOUTS} rollouts, horizon ${HORIZON}, ghost + meta prior`,
  );

  if (CONTROLS_ONLY) {
    controls(SEEDS);
    return;
  }
  if (ROLLOUT_BUDGETS) {
    rolloutSweep(evaluate as StateEvaluator, ROLLOUT_BUDGETS, DEEP_HORIZON);
    return;
  }
  if (SWEEP_HORIZONS) {
    horizonSweep(evaluate as StateEvaluator, SWEEP_HORIZONS);
    return;
  }
  if (LADDER_ONLY) {
    ladderStudy(evaluate as StateEvaluator);
    return;
  }

  const items: Item[] = [];
  const fid: Fidelity = { unrepresentable: 0, legalDelta: [] };
  let captured = 0;
  let quiet = 0;
  let graded = 0;
  let unmappable = 0;
  let analysed = 0;
  const startedAt = Date.now();

  const jobs: { seed: number; eps: number }[] = [];
  for (const seed of SEEDS) for (const eps of EPSILONS) jobs.push({ seed, eps });

  for (let ji = 0; ji < jobs.length; ji++) {
    const { seed, eps } = jobs[ji];
    // The deck and shuffle are seeded WITHOUT epsilon, so the bands are paired
    // on the same games and only the graded player's error rate differs.
    const all = collect(seed, eps);
    captured += all.length;
    const chosen = sample(all, MAX_DECISIONS, hashSeed(`coach-trust:${seed}:sample`));
    analysed += chosen.length;
    console.log(
      `[coach-trust] job ${ji + 1}/${jobs.length}  seed ${seed}  eps ${eps}  ` +
        `${all.length} captured, ${chosen.length} sampled  (${items.length} items so far, ` +
        `${((Date.now() - startedAt) / 1000).toFixed(0)}s)`,
    );
    for (const d of chosen) {
      const before = fid.unrepresentable;
      const p = production(d, evaluate as StateEvaluator, seed, fid);
      if (!p) {
        // A position the ghost could not represent is a FIDELITY failure, not
        // the coach choosing to stay quiet. Counting it as quiet would let
        // missing card support read as admirable restraint.
        if (fid.unrepresentable === before) quiet += 1;
        continue;
      }
      graded += 1;
      // Back across the ghost boundary, by name again.
      const suggestedTrue = findSemantic(d.legal, p.suggestedGhost);
      if (!suggestedTrue) {
        unmappable += 1;
        continue;
      }
      const o = oracle(d, suggestedTrue, seed);
      if (!o) continue;
      items.push({
        gameId: d.gameId,
        epsilon: d.epsilon,
        turn: d.turn,
        playedKind: d.move.kind,
        suggestedKind: suggestedTrue.kind,
        played: describeMove(d.state, d.actor, d.move),
        suggested: describeMove(d.state, d.actor, suggestedTrue),
        legalCount: d.legal.length,
        ghostLegalCount: p.ghostLegalCount,
        stakes: p.stakes,
        regret: p.regret,
        regretSe: p.regretSe,
        severity: p.severity,
        capture: p.capture,
        oracleDelta: o.delta,
        oracleSe: o.se,
        oracleQ: o.q,
        prodQ: p.qChosen,
        verdict: o.verdict,
      });
    }
  }

  const elapsed = (Date.now() - startedAt) / 1000;

  // FIDELITY, reported on its own and never folded into precision. Folding
  // them together lets missing card support masquerade as bad judgement.
  console.log("\nFIDELITY — can the ghost even represent the position?");
  console.log(`  captured decisions              ${captured}`);
  console.log(`  sampled for analysis            ${analysed}`);
  console.log(`  played move unrepresentable     ${fid.unrepresentable}`);
  console.log(`  production stayed quiet         ${quiet}`);
  console.log(
    `  production surfaced advice      ${graded}` +
      (analysed > 0 ? `  (${((100 * graded) / analysed).toFixed(1)}% of sampled)` : ""),
  );
  console.log(`  suggestion unmappable back      ${unmappable}`);
  if (fid.legalDelta.length > 0) {
    console.log(
      `  ghost legal set vs true         ${mean(fid.legalDelta).toFixed(1)} moves ` +
        `(sd ${sd(fid.legalDelta).toFixed(1)})`,
    );
  }

  console.log(`\nHEADLINE — does the suggested move beat the played one under the oracle?`);
  console.log(`  ${rate(items)}`);
  if (items.length === 0) {
    console.log(
      "  no recommendations surfaced. Raise --epsilon or --decisions; at low " +
        "epsilon the graded player plays the pilot's own moves and there is " +
        "nothing to flag.",
    );
  } else {
    const decided = items.filter(
      (i) => i.verdict === "CONFIRMED" || i.verdict === "CONTRADICTED",
    );
    if (decided.length >= 5) {
      const c = decided.filter((i) => i.verdict === "CONFIRMED").length;
      const p = c / decided.length;
      const se = Math.sqrt((p * (1 - p)) / decided.length);
      const z = se > 0 ? (p - 0.5) / se : 0;
      console.log(
        `  precision ${(100 * p).toFixed(1)}% of ${decided.length} resolved  z=${z.toFixed(2)} vs coin-flip  ` +
          (z > 1.96
            ? "SEPARABLE — the coach's suggestions are right more often than not."
            : z < -1.96
              ? "SEPARABLE IN THE WRONG DIRECTION — do not ship."
              : "NOT SEPARABLE at this n."),
      );
    }
    const mo = mean(items.map((i) => i.oracleDelta));
    const so = sd(items.map((i) => i.oracleDelta)) / Math.sqrt(items.length);
    console.log(
      `  mean oracle gain from following the advice: ${pts(mo)} pts (±${pts(1.96 * so)})`,
    );

    // Epsilon first: it qualifies the headline. Precision measured only on a
    // deliberately bad player is precision on mistakes no real player makes,
    // and the trend across bands is the part worth reading.
    section("BY EPSILON BAND (the graded player's error rate)", items, (i) =>
      i.epsilon.toFixed(2),
    );
    section("BY SEVERITY", items, (i) => i.severity);
    section("BY PLAYED KIND", items, (i) => i.playedKind);
    section("BY SUGGESTED KIND", items, (i) => i.suggestedKind);
    section("BY TURN PHASE", items, (i) =>
      i.turn <= 4 ? "early (<=4)" : i.turn <= 10 ? "mid (5-10)" : "late (11+)",
    );
    section("BY LEGAL-MOVE COUNT", items, (i) =>
      i.legalCount < 10 ? "<10" : i.legalCount < 20 ? "10-19" : i.legalCount < 30 ? "20-29" : "30+",
    );
    section("BY STAKES", items, (i) =>
      i.stakes < 0.1 ? "<10 pts" : i.stakes < 0.25 ? "10-25 pts" : i.stakes < 0.5 ? "25-50 pts" : "50+ pts",
    );
  }

  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify({ items, fidelity: fid, captured, quiet }, null, 2));
    console.log(`\n[coach-trust] wrote ${JSON_OUT}`);
  }
  console.log(`\n${elapsed.toFixed(0)}s`);
  // Exit 0 regardless of verdict. A negative result is a result.
}

main();
