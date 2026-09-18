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
  type StateEvaluator,
} from "@/lib/engine/sim";

import {
  calibrate,
  severityOf,
  type CalibrationArtifact,
} from "./calibrate";
import { determinizeLogSide, determinizeRng } from "./determinize";
import { emptyScanStats, scanLog, type LogRow, type ScanStats } from "./logDecisions";
import { analyzeDecision, sameMove } from "./regret";

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
}

/** Measured over the full 271-log corpus (4,698 valued decisions). */
export const DEFAULT_SEVERITY = {
  inaccuracy: 0.0903,
  mistake: 0.2412,
  blunder: 0.5849,
};

export function coachGame(row: LogRow, options: CoachOptions): CoachedGame {
  const rollouts = options.rollouts ?? 16;
  const horizon = options.horizon === undefined ? 6 : options.horizon;
  const seed = options.seed ?? 1;
  const severity = options.severity ?? DEFAULT_SEVERITY;
  const minStakes = options.minStakes ?? 0.02;
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
    });
  });

  const captures = decisions.map((x) => x.capture).filter((x): x is number => x !== null);
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
