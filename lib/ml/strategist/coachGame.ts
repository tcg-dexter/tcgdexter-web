// One battle log in, graded decisions out.
//
// This is the product surface the mission asks for — "take a battle log as
// input and identify skilled and unskilled plays" — factored out of
// scripts/ml/coach_report.ts so the app can call it without inheriting a
// CLI's calibration-fitting and validation reporting.
//
// WHAT IT REPORTS, AND IN WHAT UNITS
//
// `regret` is ORDINAL. It is denominated in the search's Q, which
// discriminates well on real logs (bottom decile won 41.5% of the time, top
// decile 92.9%) but is not calibrated to any real population (mean
// |predicted - actual| 27.6 points before correction). Pass a
// CalibrationArtifact to get `regretCalibrated`, and even then the honest
// reading is "players in positions like this went on to win X% of the time",
// not "you had an X% chance".
//
// `severity` needs no calibration at all — it is a quantile of the observed
// regret distribution, so "worse than 98% of decisions" is true of an ordinal
// score. Prefer it for anything a user reads.
//
// `capture` — the share of the value actually on the table that this move
// took — is the one to aggregate over a game. Raw mean regret does NOT track
// skill: it scales with the position's stakes, stakes scale with board
// development, and a developed board is what winning looks like, so raw
// regret rewards the player who never built one. Measured on 271 logs, mean
// regret separates winners from losers at z=-0.20 (nothing) while mean
// capture separates them at z=+4.67.

import {
  HeuristicPolicy,
  describeMove,
  hashSeed,
  type DecisionPolicy,
  type SimMove,
  type StateEvaluator,
} from "@/lib/engine/sim";

import {
  calibrate,
  severityOf,
  type CalibrationArtifact,
} from "./calibrate";
import { determinizeLogSide, determinizeRng } from "./determinize";
import {
  emptyScanStats,
  scanLog,
  type LogDecision,
  type LogRow,
  type ScanStats,
} from "./logDecisions";
import { analyzeDecision, sameMove, semanticMoveKey } from "./regret";

export type Severity = "ok" | "inaccuracy" | "mistake" | "blunder";

export interface CoachedDecision {
  /** 1-indexed turn within the log, when the log carried one. */
  turn: number | null;
  actionIndex: number;
  played: string;
  playedKind: string;
  /** The best move that was NOT the one played, or null when it was best. */
  bestAlternative: string | null;
  /** Ordinal. Positive means a better move existed. */
  regret: number;
  /** Paired standard error of `regret`. */
  regretSe: number;
  /** Only present when a calibration artifact was supplied. */
  regretCalibrated: number | null;
  severity: Severity;
  /** regret > 2 * regretSe — below this, say nothing. */
  significant: boolean;
  /** Share of the value on the table that this move captured, in [0,1].
   *  Null when every move was worth the same (nothing was at stake). */
  capture: number | null;
  /** Best minus worst across the legal set: how much this decision mattered. */
  stakes: number;
  /** Raw Q of the resulting position, and of the best available. Exposed so
   *  a caller can FIT a calibration map from real outcomes without re-running
   *  the search — the script that does so is then a pure aggregator over
   *  these records and cannot drift from what the app sees. */
  qChosen: number;
  qBest: number;
  /** A play worth praising: best move, decision mattered, and a competent
   *  reference policy would have played something materially worse. */
  skilled: boolean;
  legalCount: number;
  /** True when the played card had to be put back into hand because the
   *  replay reducer never saw it. Such a decision is RECOVERED rather than
   *  observed: the move itself is certain (the log says it happened) but the
   *  rest of the hand is a floor on the real one, so its alternatives — and
   *  therefore its `capture` — carry more uncertainty than an observed
   *  decision's. Exposed so a consumer can weight or exclude them rather than
   *  discovering the difference as unexplained noise. */
  materialized: boolean;
  /** The oracle proves both moves lead to the same result — the advice is
   *  CORRECT and IRRELEVANT. Null when not checked (see CoachOptions.verifyMoot).
   *
   *  A "blunder" chip on a game the player had already won reads as the coach
   *  not understanding the game, and 20% of surfaced advice is like this,
   *  rising past 30% after turn 21. Nothing production computes predicts it:
   *  its own Q is at chance (AUC 0.503), a model over every available feature
   *  reaches 0.691, and a turn threshold hides two good calls per moot one. So
   *  it is VERIFIED rather than predicted, on the few decisions that would
   *  carry a chip. */
  moot: boolean | null;
}

export interface CoachedGame {
  logId: string;
  decisions: CoachedDecision[];
  /** Human decisions the engine could represent, over those it found. */
  coverage: number;
  /** Mean capture across decisions where something was at stake. This is the
   *  game-level skill number; mean regret is not. */
  meanCapture: number | null;
  blunders: CoachedDecision[];
  highlights: CoachedDecision[];
  stats: ScanStats;
}

export interface CoachOptions {
  evaluate: StateEvaluator;
  rollouts?: number;
  horizon?: number | null;
  seed?: number;
  calibration?: CalibrationArtifact | null;
  /** Regret quantile thresholds. Defaults are the values measured across the
   *  271-log corpus; pass fresh ones when the population changes. */
  severity?: { inaccuracy: number; mistake: number; blunder: number };
  /** A decision with less than this much spread had nothing at stake, so its
   *  capture is meaningless and excluded from the mean. */
  minStakes?: number;
  /** The pilot that plays out the rest of the game in every rollout.
   *
   *  This sets what Q MEANS: "the value of this move if play continues like
   *  THIS". A coach cannot see above the level of its rollout pilot — a setup
   *  play whose payoff needs good follow-up scores badly when the follow-up
   *  is weak. Defaults to HeuristicPolicy, which is measured at parity with
   *  the planner and is fast; the distilled apprentice is the same speed
   *  class and the same strength class, so it is a drop-in candidate worth
   *  measuring rather than assuming. */
  rolloutPolicy?: () => DecisionPolicy;
  /** Verify, on decisions that would carry a chip, whether the advice can
   *  change the result at all — by rolling BOTH moves to a real terminal with
   *  no evaluator, which is the only thing measured to detect it.
   *
   *  Runs on roughly 6 decisions a game rather than 26, which is what makes an
   *  oracle affordable here. Measured against a 480-rollout reference:
   *
   *      24 rollouts   84% precision, 100% recall, 0.05 s
   *      96 rollouts   91% precision, 100% recall, 0.20 s
   *     192 rollouts   98% precision, 100% recall, 0.39 s
   *
   *  Recall is 100% everywhere because genuinely equivalent moves agree in
   *  every rollout; the budget buys PRECISION, i.e. not suppressing real
   *  advice. Below ~90% suppression costs more credibility than it protects,
   *  so 192 is the default and 24 is not a safe economy. */
  verifyMoot?: boolean | { rollouts?: number };
}

/** Measured over the full 271-log corpus (4,698 valued decisions). */
/** 98% precision / 100% recall against a 480-rollout reference. */
export const MOOT_ROLLOUTS = 192;

export const DEFAULT_SEVERITY = {
  inaccuracy: 0.0903,
  mistake: 0.2412,
  blunder: 0.5849,
};

/**
 * Would following this advice have changed anything?
 *
 * Two arms, rolled to a REAL TERMINAL with no evaluator consulted, so the
 * answer does not depend on the same value model that produced the advice.
 * "Moot" is every paired rollout coming out identical — which is a claim about
 * the game, not about the estimator.
 *
 * Returns null when it cannot be determined, which is NOT the same as false and
 * must not be rendered as "this mattered".
 */
function verifyMoot(
  d: LogDecision,
  played: SimMove,
  alternative: SimMove,
  rollouts: number,
  seed: number,
): boolean | null {
  try {
    const wanted = new Set([semanticMoveKey(played), semanticMoveKey(alternative)]);
    const seen = new Set<string>();
    const a = analyzeDecision(d.state, "player", d.ctx, played, {
      rollouts,
      horizon: null,
      evaluate: null,
      seed,
      // THE SAME determinization the scored analysis uses, and for the same
      // reason. A log replay knows only what surfaced, so both decks are
      // empty; rolled to a terminal untreated, BOTH arms deck out identically
      // in every rollout and every decision reads as moot. Measured before
      // this hook existed: 83% "moot" on real logs against 20% on self-play
      // positions — a number that would have suppressed almost every chip.
      //
      // Pure in the rollout index, so the arms stay paired under common
      // random numbers; varying it per ARM would make the comparison a lie.
      prepare: (clone, r) => {
        const rng = determinizeRng(seed, r);
        determinizeLogSide(clone, "opponent", rng);
        if (clone.sides.player.deck.length === 0) {
          determinizeLogSide(clone, "player", rng);
        }
      },
      candidateFilter: (m) => {
        const k = semanticMoveKey(m);
        if (!wanted.has(k) || seen.has(k)) return false;
        seen.add(k);
        return true;
      },
    });
    if (!a || a.candidates.length < 2) return null;
    const i = a.candidates.findIndex((c) => semanticMoveKey(c.move) === semanticMoveKey(played));
    const j = a.candidates.findIndex(
      (c) => semanticMoveKey(c.move) === semanticMoveKey(alternative),
    );
    if (i < 0 || j < 0) return null;
    return a.candidates[i].samples.every((v, k) => v === a.candidates[j].samples[k]);
  } catch {
    return null;
  }
}

export function coachGame(row: LogRow, options: CoachOptions): CoachedGame {
  const rollouts = options.rollouts ?? 16;
  const horizon = options.horizon === undefined ? 6 : options.horizon;
  const seed = options.seed ?? 1;
  const severity = options.severity ?? DEFAULT_SEVERITY;
  // 5 points, not 2. `capture` is a RATIO with stakes in the denominator, so a
  // decision worth almost nothing yields an unstable share of almost nothing.
  // Swept against real outcomes over 371 logs (observed decisions, pooled
  // within player): 2 pts z=2.72, 5 pts z=3.30, 10 pts z=2.77, 20 pts z=2.98
  // on only two usable players. 5 is the strongest point that still rests on
  // five.
  const minStakes = options.minStakes ?? 0.05;
  const mootRollouts =
    options.verifyMoot === true
      ? MOOT_ROLLOUTS
      : typeof options.verifyMoot === "object" && options.verifyMoot
        ? (options.verifyMoot.rollouts ?? MOOT_ROLLOUTS)
        : 0;
  const makePilot = options.rolloutPolicy ?? (() => new HeuristicPolicy());

  const stats = emptyScanStats();
  const decisions: CoachedDecision[] = [];

  scanLog(row, stats, (d) => {
    const decisionSeed = hashSeed(`${seed}:${row.id}:${d.actionIndex}`);
    const analysis = analyzeDecision(d.state, "player", d.ctx, d.legal[d.humanIndex], {
      rollouts,
      horizon,
      evaluate: options.evaluate,
      seed: decisionSeed,
      policies: { player: makePilot(), opponent: makePilot() },
      // A log replay knows neither deck's remaining contents. Rolled forward
      // untreated, both sides deck out immediately, every candidate "wins",
      // and the report is confident nonsense.
      prepare: (clone, r) => {
        const rng = determinizeRng(decisionSeed, r);
        determinizeLogSide(clone, "opponent", rng);
        if (clone.sides.player.deck.length === 0) {
          determinizeLogSide(clone, "player", rng);
        }
      },
    });
    if (!analysis || analysis.regret === null || analysis.chosenIndex === null) return;

    const qs = analysis.candidates.map((c) => c.q);
    const hi = Math.max(...qs);
    const lo = Math.min(...qs);
    const stakes = hi - lo;
    const played = d.legal[d.humanIndex];
    const alt = analysis.alternativeIndex;

    // Skilled: took (essentially) the best move, on a decision that mattered,
    // where a competent reference would have done materially worse. All three
    // together — without the third, every forced-looking best move is genius.
    let skilled = false;
    const human = analysis.candidates[analysis.chosenIndex];
    try {
      const refMove = new HeuristicPolicy().chooseMove(d.view, d.legal, d.ctx);
      const ref = analysis.candidates.find((c) => sameMove(c.move, refMove));
      if (ref && !sameMove(ref.move, human.move)) {
        const paired = human.samples.map((v, k) => v - ref.samples[k]);
        const m = paired.reduce((a, b) => a + b, 0) / paired.length;
        const sd = Math.sqrt(
          paired.reduce((s, v) => s + (v - m) * (v - m), 0) / Math.max(1, paired.length - 1),
        );
        const se = sd / Math.sqrt(paired.length);
        const nearBest = analysis.regret! <= 2 * Math.max(analysis.regretSe, 0.005);
        skilled = nearBest && stakes > 0.15 && se > 0 && m > 2 * se;
      }
    } catch {
      skilled = false;
    }

    decisions.push({
      turn: d.turnNumber,
      actionIndex: d.actionIndex,
      played: describeMove(d.state, "player", played),
      playedKind: played.kind,
      bestAlternative:
        alt !== null ? describeMove(d.state, "player", analysis.candidates[alt].move) : null,
      regret: analysis.regret,
      regretSe: analysis.regretSe,
      regretCalibrated: options.calibration
        ? calibrate(options.calibration, hi) - calibrate(options.calibration, qs[analysis.chosenIndex])
        : null,
      severity: severityOf(analysis.regret, severity),
      significant: analysis.significant,
      capture: stakes > minStakes ? (qs[analysis.chosenIndex] - lo) / stakes : null,
      stakes,
      qChosen: qs[analysis.chosenIndex],
      qBest: hi,
      skilled,
      legalCount: d.legal.length,
      materialized: d.materialized,
      // Only decisions that would actually carry a chip. Checking every
      // decision would triple the cost of a report to answer a question
      // nobody is asking about the ones we stay quiet on.
      moot:
        mootRollouts > 0 &&
        alt !== null &&
        analysis.significant &&
        severityOf(analysis.regret, severity) !== "ok"
          ? verifyMoot(
              d,
              played,
              analysis.candidates[alt].move,
              mootRollouts,
              hashSeed(`coach-moot:${row.id}:${d.actionIndex}`),
            )
          : null,
    });
  });

  // MEAN CAPTURE EXCLUDES RECOVERED DECISIONS, and that is load-bearing.
  //
  // A decision whose played card had to be put back into hand (`materialized`)
  // has a CERTAIN played move — the log says it happened — but a hand that is
  // only a floor on the real one, so the alternatives `capture` divides by are
  // incomplete. Measured over 371 logs, pooled within player:
  //
  //     all decisions   +1.5 pts  z=0.90   not separable
  //     observed only   +5.4 pts  z=2.72   separable
  //     recovered only  +0.6 pts  z=0.22   no signal at all
  //
  // Recovered decisions carry no skill signal, and not because they are small
  // — their mean stakes are 17.9 pts against observed 20.5. Including them
  // makes the game-level number meaningless, which is why the per-DECISION
  // advice still ships (the move is certain) while the aggregate does not.
  const captures = decisions
    .filter((x) => !x.materialized)
    .map((x) => x.capture)
    .filter((x): x is number => x !== null);
  return {
    logId: row.id,
    decisions,
    coverage: stats.decisions > 0 ? stats.matched / stats.decisions : 0,
    meanCapture:
      captures.length > 0 ? captures.reduce((a, b) => a + b, 0) / captures.length : null,
    blunders: decisions
      .filter((x) => x.significant && x.severity !== "ok")
      .sort((a, b) => b.regret - a.regret),
    highlights: decisions.filter((x) => x.skilled).sort((a, b) => b.stakes - a.stakes),
    stats,
  };
}
