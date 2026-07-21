// Win-probability swing insights — the first review signal derived from the
// board-aware value model rather than hand-written rules.
//
// The honest v1: given the per-turn value curve of a replayed log, flag the
// player turns across which the player's own win probability fell the most.
// A big self-inflicted drop is a *blunder candidate* — the state got worse
// on your watch. We deliberately do NOT claim what the best move was: that
// requires enumerating legal moves on reconstructed real-log states, which
// v1 does not do. The copy reflects that ("your position worsened"), not
// fake certainty ("you should have played X").
//
// Pure over plain data (WinProbPoint[]), same as heuristics.ts, so the
// thresholds are unit-testable without any engine state.

import type { WinProbPoint } from "@/lib/ml/winprob";
import type { CoachInsight } from "./heuristics";

/** Minimum drop across a player turn to call it a swing at all. */
export const SWING_THRESHOLD = 0.1;
/** At this size a swing reads as decisive, not incidental. */
export const SWING_WARNING_THRESHOLD = 0.2;
/** Cap: only the biggest swings are worth the user's attention. */
export const MAX_SWING_INSIGHTS = 2;

export interface SwingOptions {
  /** When true (replay diagnostics errored, or card coverage was poor) the
   *  curve is not trustworthy enough to editorialize over — no insights. */
  lowConfidence?: boolean;
}

const pct = (p: number) => Math.round(p * 100);

/**
 * Swing insights from a value curve. `curve` must be in turn order; deltas
 * are taken across each player turn (value at its end minus value at the end
 * of the previous playable turn).
 */
export function swingInsights(
  curve: WinProbPoint[],
  options: SwingOptions = {},
): CoachInsight[] {
  if (options.lowConfidence || curve.length < 2) return [];

  const drops: { turn: number; delta: number; from: number; to: number }[] = [];
  for (let i = 1; i < curve.length; i++) {
    const point = curve[i];
    if (point.actor !== "player") continue;
    const prev = curve[i - 1];
    const delta = point.p_win - prev.p_win;
    if (delta <= -SWING_THRESHOLD) {
      drops.push({ turn: point.turn_number, delta, from: prev.p_win, to: point.p_win });
    }
  }

  drops.sort((a, b) => a.delta - b.delta);
  return drops.slice(0, MAX_SWING_INSIGHTS).map(({ turn, delta, from, to }) => ({
    code: "winprob_swing",
    severity: -delta >= SWING_WARNING_THRESHOLD ? ("warning" as const) : ("suggestion" as const),
    turn_number: turn,
    title: `Win chances fell ${pct(-delta)} points across turn ${turn}`,
    detail:
      `Our model estimated your win probability at ${pct(from)}% going into turn ${turn} ` +
      `and ${pct(to)}% after it — one of the biggest shifts against you in this game. ` +
      `Worth replaying this turn: the position, not just the luck, moved toward your ` +
      `opponent here.`,
  }));
}
