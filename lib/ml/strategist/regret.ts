// What was every move at this decision actually worth?
//
// WHY THIS EXISTS
//
// Two years of work on this bot optimised a POLICY: a function that names one
// move. Six interventions on the position evaluator moved nothing end to end,
// and three attempts to replace the planner's hardcoded priority list — beam
// search, a development bonus, a learned ranker over 890k decisions — all came
// back separably WORSE than the priority list they were meant to replace.
//
// A policy answers "what would I play". It cannot answer "what was that worth,
// and what was the alternative worth" — and that second question is the one
// both remaining products need:
//
//   * COACHING is regret. "You played Ultra Ball; benching the second Zorua
//     was worth 8 more points of win probability" is a per-decision, signed,
//     magnitude-carrying statement. No argmax produces it.
//   * TRAINING has only ever had imitation targets (copy the teacher) or game
//     outcomes (one bit per ~100 decisions). Q-values over every legal move
//     are counterfactual supervision, and they are not bounded by the
//     teacher's strength — which is precisely why the ranker plateaued at 50%
//     top-1 against a teacher that is itself only heuristic-strength.
//
// HOW IT WORKS
//
// For each legal move: clone the state, force that move, hand the turn back to
// the pilot, and play forward. Either to the end of the game, or to a horizon
// where a learned evaluator scores the board. The mean over rollouts is Q.
//
// Rolling forward is the point. A development move (bench a Basic, attach to a
// future attacker) scores neutral-to-negative under any static evaluator — this
// is documented in planner.ts and is exactly why the priority list has to
// exist. In a rollout its payoff simply happens: the benched Pokémon is there
// to attack two turns later, and Q sees it. `developmentValue`, the linear
// board bonus that tried to express the same knowledge, moved 1 of 12 real
// decisions under a 500x weight sweep. Search does not have to express it.
//
// VARIANCE IS THE WHOLE PROBLEM, AND IT IS HANDLED IN THREE PLACES
//
//   1. COMMON RANDOM NUMBERS. Rollout r of every arm uses an identically
//      seeded rng, so the arms share their luck and the DIFFERENCE between two
//      arms is far better resolved than either arm's absolute value.
//   2. PAIRED ERROR BARS. The reported error is the SD of the per-rollout
//      DIFFERENCE, never the SD of two independent means. An unpaired bar here
//      would be roughly twice as wide and would call every real finding noise.
//   3. SELECTION BIAS. max-of-K noisy means is biased upward — with 20
//      candidates and 12 rollouts, "the best move" beats the chosen move by a
//      few points even when every move is identical. So the best arm is CHOSEN
//      on one half of the rollouts and VALUED on the other. `regretNaive`
//      keeps the biased figure for comparison; it is not the number to quote.
//
// The instrument's resolution is a measured property, not an assumption:
// `scripts/ml/regret_calibration.ts` runs the null (all arms identical) and
// reports what regret this thing reports when the true regret is zero.

import {
  HeuristicPolicy,
  legalMoves,
  mulberry32,
  hashSeed,
  resumeGame,
  describeMove,
  type DecisionPolicy,
  type SimMove,
  type StateEvaluator,
  type TurnContext,
} from "@/lib/engine/sim";
import type { GameState } from "@/lib/engine/types";

import { outcomeValue, stateValue, type Actor } from "./value";

export interface ArmValue {
  move: SimMove;
  /** Human-readable, built against the PRE-move state. */
  label: string;
  /** Mean value over all rollouts, in P(win) units for the deciding actor. */
  q: number;
  /** Standard error of `q` on its own. Wide — use the paired bars instead. */
  se: number;
  /** Per-rollout values, index-aligned across arms (common random numbers). */
  samples: number[];
}

export interface DecisionAnalysis {
  actor: Actor;
  turn: number;
  candidates: ArmValue[];
  /** Index into `candidates` of the move actually played, or null when the
   *  caller is asking "what is best here" rather than judging a played move. */
  chosenIndex: number | null;
  /** Full-sample argmax. For display and ordering; see the selection-bias
   *  note above before quoting a difference built from it. */
  bestIndex: number;
  /** Best arm that is not the chosen one — the coaching suggestion. */
  alternativeIndex: number | null;
  /** Split-sample estimate of what the chosen move gave up. Positive means
   *  a better move existed. Null when nothing was chosen. */
  regret: number | null;
  /** Paired standard error of `regret`. */
  regretSe: number;
  /** Same quantity without the selection split — reported only so the bias
   *  is visible rather than hidden. */
  regretNaive: number | null;
  /** regret > 2 * regretSe. Nothing below this should be shown to a user or
   *  fed to a trainer as a labelled mistake. */
  significant: boolean;
  rollouts: number;
  horizon: number | null;
}

export interface RegretOptions {
  /** Rollouts per candidate. */
  rollouts?: number;
  /** Player-turns to simulate before scoring with `evaluate`. null plays the
   *  game to its end and scores 1 / 0.5 / 0, which is unbiased but carries
   *  Bernoulli variance (SD 0.5) — roughly 10x the rollouts for the same
   *  resolution. */
  horizon?: number | null;
  /** Leaf evaluator. Required when `horizon` is finite. */
  evaluate?: StateEvaluator | null;
  /** Pilots for the continuation. Defaults to HeuristicPolicy on both sides:
   *  it is measured at parity with the planner (51.53%, not separable) and is
   *  an order of magnitude faster, so it is the better rollout pilot on both
   *  counts. */
  policies?: { player: DecisionPolicy; opponent: DecisionPolicy };
  /** Base seed. The same seed reproduces an analysis exactly. */
  seed?: number | string;
  /** Skip analysis entirely above this many legal moves (cost is linear in
   *  candidates). 0 or less means no cap. */
  maxCandidates?: number;
  /** Restrict to these moves instead of every legal one. */
  candidateFilter?: (move: SimMove) => boolean;
}

const DEFAULT_ROLLOUTS = 12;
const DEFAULT_HORIZON = 6;

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}

function stderr(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1);
  return Math.sqrt(v / xs.length);
}

/** Canonical string for a move: key-sorted, recursive, undefined-dropped.
 *
 *  It has to be recursive. A SimMove is not flat — `riderPicks`,
 *  `attachPicks`, `triggerPicks`, `benchCounters`, `benchDamageTargets` and
 *  `riderDiscardCardIds` are arrays and `copyPick` is an object. A shallow
 *  `!==` comparison therefore returns "different" for every move carrying
 *  picks, which is most attacks and every declarative effect. That bug
 *  silently dropped a third of decisions from the first calibration run
 *  (pilot n=81 of 120) and reported the survivors as a clean result. */
export function moveKey(move: SimMove): string {
  const canon = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(canon);
    const obj = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      if (obj[k] !== undefined) out[k] = canon(obj[k]);
    }
    return out;
  };
  return JSON.stringify(canon(move));
}

/** Are two moves the same decision? SimMoves are structural, and the same
 *  move re-enumerated on a rebuilt state is a different object. */
export function sameMove(a: SimMove, b: SimMove): boolean {
  return a.kind === b.kind && moveKey(a) === moveKey(b);
}

function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

/** One rollout of one arm. Returns P(win) for `actor`. */
function rollOut(
  state: GameState,
  actor: Actor,
  ctx: TurnContext,
  move: SimMove,
  seed: number,
  opts: {
    horizon: number | null;
    evaluate: StateEvaluator | null;
    policies: { player: DecisionPolicy; opponent: DecisionPolicy };
  },
): number {
  const clone = cloneState(state);
  const rng = mulberry32(seed);
  const { outcome } = resumeGame(clone, actor, opts.policies, rng, {
    ctx: { ...ctx },
    firstMove: move,
    maxPlies: opts.horizon ?? undefined,
  });
  if (outcome) return outcomeValue(outcome, actor);
  if (!opts.evaluate) {
    // Reaching here means a finite horizon with no evaluator, which the
    // entry point refuses. Throwing rather than returning 0.5 is deliberate:
    // a plausible number is the failure mode that has cost this project the
    // most time.
    throw new Error("regret: horizon reached with no leaf evaluator");
  }
  return stateValue(clone, actor, opts.evaluate);
}

/**
 * Value every legal move at one decision.
 *
 * `state` is NOT mutated. `chosen` is optional: pass it to get a regret for a
 * move that was actually played (coaching, labelling), omit it to get a
 * ranking (play, suggestion).
 */
export function analyzeDecision(
  state: GameState,
  actor: Actor,
  ctx: TurnContext,
  chosen: SimMove | null,
  options: RegretOptions = {},
): DecisionAnalysis | null {
  const rollouts = options.rollouts ?? DEFAULT_ROLLOUTS;
  const horizon = options.horizon === undefined ? DEFAULT_HORIZON : options.horizon;
  const evaluate = options.evaluate ?? null;
  if (horizon !== null && !evaluate) {
    throw new Error(
      "analyzeDecision: a finite horizon needs an evaluator; pass horizon: null to play to the end",
    );
  }
  const policies = options.policies ?? {
    player: new HeuristicPolicy(),
    opponent: new HeuristicPolicy(),
  };
  const baseSeed =
    typeof options.seed === "number"
      ? options.seed
      : hashSeed(options.seed ?? "strategist");

  let legal = legalMoves(state, actor, ctx);
  if (options.candidateFilter) legal = legal.filter(options.candidateFilter);
  const cap = options.maxCandidates ?? 0;
  if (legal.length < 2) return null;
  if (cap > 0 && legal.length > cap) return null;

  const candidates: ArmValue[] = legal.map((move) => ({
    move,
    label: describeMove(state, actor, move),
    q: 0,
    se: 0,
    samples: [],
  }));

  for (let r = 0; r < rollouts; r++) {
    // Common random numbers: arm-independent, rollout-dependent.
    const seed = hashSeed(`${baseSeed}|${r}`);
    for (const arm of candidates) {
      arm.samples.push(
        rollOut(state, actor, ctx, arm.move, seed, { horizon, evaluate, policies }),
      );
    }
  }
  for (const arm of candidates) {
    arm.q = mean(arm.samples);
    arm.se = stderr(arm.samples);
  }

  const bestIndex = argmax(candidates.map((c) => c.q));
  const chosenIndex = chosen ? candidates.findIndex((c) => sameMove(c.move, chosen)) : -1;

  let alternativeIndex: number | null = null;
  {
    let best = -Infinity;
    for (let i = 0; i < candidates.length; i++) {
      if (i === chosenIndex) continue;
      if (candidates[i].q > best) {
        best = candidates[i].q;
        alternativeIndex = i;
      }
    }
  }

  let regret: number | null = null;
  let regretNaive: number | null = null;
  let regretSe = 0;
  if (chosenIndex >= 0) {
    regretNaive = candidates[bestIndex].q - candidates[chosenIndex].q;

    // Selection split: pick the comparison arm on the even-indexed rollouts,
    // value it on the odd ones. With fewer than 4 rollouts there is nothing
    // to split, so fall back and say so through the error bar.
    const evens = (xs: number[]) => xs.filter((_, i) => i % 2 === 0);
    const odds = (xs: number[]) => xs.filter((_, i) => i % 2 === 1);
    const selectOn = candidates.map((c) => mean(evens(c.samples)));
    const pick = argmax(selectOn);
    const valueSamples = odds(candidates[pick].samples);
    const chosenSamples = odds(candidates[chosenIndex].samples);
    regret =
      rollouts >= 4 ? mean(valueSamples) - mean(chosenSamples) : regretNaive;

    // Paired bar on the arm the regret is actually quoted against.
    const paired = (rollouts >= 4 ? valueSamples : candidates[bestIndex].samples).map(
      (v, i) => v - (rollouts >= 4 ? chosenSamples : candidates[chosenIndex].samples)[i],
    );
    regretSe = stderr(paired);
  }

  return {
    actor,
    turn: state.turn.number,
    candidates,
    chosenIndex: chosenIndex >= 0 ? chosenIndex : null,
    bestIndex,
    alternativeIndex,
    regret,
    regretSe,
    regretNaive,
    significant: regret !== null && regretSe > 0 && regret > 2 * regretSe,
    rollouts,
    horizon,
  };
}

function argmax(xs: number[]): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i] > xs[best]) best = i;
  return best;
}
