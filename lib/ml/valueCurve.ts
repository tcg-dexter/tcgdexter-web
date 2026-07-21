// Value curve — the board-aware value model applied to a sequence of
// PlayerViews (per-turn end states of a replayed battle log).
//
// This is the review-side twin of botEvaluator's createBoardEvaluator: same
// artifact, same encoder, same scorer — but shaped for "score this whole
// game" rather than "score this candidate plan", and with the artifact
// cached at module scope (value.json is ~650 KB; the planner path constructs
// one evaluator per game, an API route would otherwise re-read and re-parse
// it on every request).
//
// Output reuses winprob's WinProbPoint shape so the existing sparkline
// renders either model's curve unchanged.

import type { WinProbPoint } from "./winprob";
import {
  readValueArtifact,
  scoreGbdt,
  scoreLinearVector,
  type ValueArtifact,
} from "./botEvaluator";
import { STATE_FEATURE_NAMES, encodeStateFeatures } from "./features/policy";
import type { ReplayTurnView } from "./features/replayView";

let cached: { artifact: ValueArtifact | null } | null = null;

/** Registry-resolved value artifact, read once per process. */
export function cachedValueArtifact(): ValueArtifact | null {
  if (cached === null) cached = { artifact: readValueArtifact() };
  return cached.artifact;
}

/** Test hook: drop the cache so a different artifact/env can be picked up. */
export function resetValueArtifactCache(): void {
  cached = null;
}

/** Score one view through the artifact. Same feature-index mapping as
 *  createBoardEvaluator; kept here in curve shape (name-indexed once per
 *  call series via the closure below). */
export function valueCurve(
  artifact: ValueArtifact,
  views: ReplayTurnView[],
): WinProbPoint[] {
  const nameIndex = new Map(STATE_FEATURE_NAMES.map((n, i) => [n, i]));
  const srcIdx = artifact.features.map((n) => nameIndex.get(n) ?? -1);
  // Trees route on exact thresholds — a feature the encoder can't produce
  // would silently mis-route every state, so refuse instead (mirrors
  // createBoardEvaluator's guard).
  if (artifact.model_type === "gbdt" && srcIdx.some((j) => j < 0)) return [];

  const row = new Float64Array(srcIdx.length);
  return views.map(({ turn_number, actor, view }) => {
    const vec = encodeStateFeatures(view);
    let p: number;
    if (artifact.model_type === "gbdt") {
      for (let i = 0; i < srcIdx.length; i++) row[i] = vec[srcIdx[i]];
      p = scoreGbdt(artifact, row);
    } else {
      p = scoreLinearVector(artifact, srcIdx, vec);
    }
    return { turn_number, actor, p_win: p };
  });
}
