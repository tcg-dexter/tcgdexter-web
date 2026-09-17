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
    ghostLegalCount: ghostLegal.length,
  };
}

/**
 * The ORACLE arm, restricted to two moves. "Is this recommendation worth
 * surfacing" does not need a full Q table — it needs only "does the suggested
 * move actually beat the played one", and cost is linear in arms, so 2-arm is
 * ~7x cheaper than the full table.
 */
function oracle(
  d: Captured,
  suggestedTrue: SimMove,
  seed: number,
  opts: { played?: SimMove; label?: string } = {},
): { delta: number; se: number; q: number; verdict: Verdict } | null {
  const playedMove = opts.played ?? d.move;
  const playedKey = semanticMoveKey(playedMove);
  const sugKey = semanticMoveKey(suggestedTrue);
  if (playedKey === sugKey) return null;
  const want = new Set([playedKey, sugKey]);
  // Dedupe by semantic key so the table is exactly two arms even when the
  // hand holds two copies of the same card.
  const seen = new Set<string>();

  const a = analyzeDecision(d.state, d.actor, d.ctx, playedMove, {
    rollouts: ORACLE_ROLLOUTS,
    // No evaluator is consulted at all. This is the independence.
    horizon: null,
    evaluate: null,
    seed: hashSeed(
      `coach-trust:${seed}:oracle${opts.label ?? ""}:${d.gameId}:${d.turn}`,
    ),
    candidateFilter: (m) => {
      const k = semanticMoveKey(m);
      if (!want.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    },
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
function controls(seed: number): void {
  const all = collect(seed, 0.35);
  const withAttack = all.filter(
    (d) => d.legal.some((m) => m.kind === "attack") && d.legal.some((m) => m.kind === "pass"),
  );
  const chosen = sample(withAttack, CONTROL_N, hashSeed(`coach-trust:${seed}:control`));

  console.log(
    `\nPOSITIVE CONTROL — is declining an available attack priced as a loss?` +
      `\n  ${withAttack.length} positions offer both an attack and a pass; ` +
      `${chosen.length} sampled`,
  );
  const gains: number[] = [];
  let significant = 0;
  let equivalent = 0;
  for (const d of chosen) {
    const attack = d.legal.find((m) => m.kind === "attack")!;
    const pass = d.legal.find((m) => m.kind === "pass")!;
    const o = oracle(d, attack, seed, { played: pass, label: ":posctl" });
    if (!o) continue;
    gains.push(o.delta);
    if (o.verdict === "CONFIRMED") significant += 1;
    if (o.verdict === "outcome-equivalent") equivalent += 1;
  }
  if (gains.length < 3) {
    console.log("  too few resolvable positions — raise --games.");
  } else {
    const m = mean(gains);
    const se = sd(gains) / Math.sqrt(gains.length);
    const z = se > 0 ? m / se : 0;
    console.log(
      `  attacking beats passing by ${pts(m)} pts (±${pts(1.96 * se)}) over n=${gains.length}\n` +
        `  ${significant} of ${gains.length} individually significant, ` +
        `${equivalent} outcome-equivalent\n` +
        `  z=${z.toFixed(2)}  ` +
        (z > 1.96
          ? "PASS — the oracle can see play quality."
          : z < -1.96
            ? "FAIL IN THE WRONG DIRECTION — passing beats attacking. Do not trust any verdict."
            : "FAIL — the oracle cannot resolve the single clearest mistake in the game."),
    );
  }

  console.log(`\nSTABILITY — same arms, independent seed`);
  const pairs: { a: number; b: number; se: number }[] = [];
  for (const d of chosen.slice(0, Math.min(12, chosen.length))) {
    const attack = d.legal.find((m) => m.kind === "attack")!;
    const pass = d.legal.find((m) => m.kind === "pass")!;
    const o1 = oracle(d, attack, seed, { played: pass, label: ":stab1" });
    const o2 = oracle(d, attack, seed + 7919, { played: pass, label: ":stab2" });
    if (o1 && o2) pairs.push({ a: o1.delta, b: o2.delta, se: Math.hypot(o1.se, o2.se) });
  }
  if (pairs.length < 3) {
    console.log("  too few pairs.");
  } else {
    const diffs = pairs.map((p) => p.a - p.b);
    const within = pairs.filter((p) => Math.abs(p.a - p.b) <= 2 * p.se).length;
    console.log(
      `  mean |difference| between runs ${pts(mean(diffs.map(Math.abs)))} pts over n=${pairs.length}\n` +
        `  ${within}/${pairs.length} agree inside their own 2-sigma bar  ` +
        (within >= Math.ceil(0.8 * pairs.length)
          ? "PASS"
          : "SUSPECT — the bars understate the true run-to-run spread."),
    );
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
    for (const seed of SEEDS) {
      console.log(`\n=== seed ${seed} ===`);
      controls(seed);
    }
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
