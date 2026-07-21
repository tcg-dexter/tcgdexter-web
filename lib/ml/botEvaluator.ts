// Wires a trained value model into the AI player's turn planner.
// Lives in lib/ml (which already depends on lib/engine) so the sim layer
// stays ML-free; callers inject the evaluator into PlannerPolicy.
//
// Two generations of evaluator live here:
//
//   * BOARD-AWARE (value.json, preferred). Scores the full redacted
//     PlayerView of the plan's end state through the 67-feature model
//     trained on self-play outcomes (dexter-ml ml_train_value.py). It can
//     see HP, damage, energy, attack readiness and threats.
//   * SNAPSHOT (winprob.json, fallback). The original 8-scalar model. Its
//     inputs are nearly constant across the candidate plans of a single
//     turn — prize_diff only moves on a KO, hand_diff by ~1, the rest not
//     at all — so it barely discriminates between plans, which is why the
//     board-aware model exists.
//
// winprob.json itself is NOT retired: it still serves human-match review
// (winProbCurve), a different job on a different feature set.

import type { PlanSnapshot, StateEvaluator } from "@/lib/engine/sim";
import { readFileSync } from "node:fs";
import path from "node:path";
import { readRegistry } from "./registry";
import { readWinProbArtifact, scoreFeatures, type WinProbArtifact } from "./winprob";
import { STATE_FEATURE_NAMES, encodeStateFeatures } from "./features/policy";

/** Linear value artifact: reuses the winprob artifact shape exactly, so the
 *  same scorer math applies; only the feature set and provenance differ. */
export type LinearValueArtifact = WinProbArtifact & { policy_schema_version?: number };

/** One boosted tree, flattened into parallel arrays by the Python exporter
 *  (dexter-ml ml_train_value_gbm.py flatten_trees).
 *
 *  Node i is INTERNAL when `feature[i] >= 0`: route left if the feature value
 *  is `<= threshold[i]`, else right. Otherwise it is a leaf and `value[i]` is
 *  its additive contribution to the logit. */
export interface GbdtTree {
  feature: number[];
  threshold: number[];
  left: number[];
  right: number[];
  value: number[];
}

/** Gradient-boosted value artifact. Exists because the discrimination probe
 *  showed the linear model was already separating sibling plans well — the
 *  remaining limit was capacity, not objective. Tree ensembles express the
 *  interactions this domain is made of (damage matters only if the KO is
 *  reachable; an attacker matters only if its energy cost is paid). */
export interface GbdtValueArtifact {
  model_type: "gbdt";
  model_version: string;
  trained_at: string;
  feature_schema_version: number;
  policy_schema_version?: number;
  n_samples: number;
  n_matches: number;
  data_hash: string;
  /** Ordered feature names; tree `feature` indices are columns of THIS array. */
  features: string[];
  trees: GbdtTree[];
  params: Record<string, number>;
  global_prior: number;
  metrics: Record<string, number | null>;
  validation_examples: { features: Record<string, number>; expected_p: number }[];
}

export type ValueArtifact = LinearValueArtifact | GbdtValueArtifact;

/**
 * Score a flattened tree ensemble. Mirrors LightGBM's numeric `<=` routing
 * exactly — the trainer refuses to export any other split type, and embeds
 * validation examples so a divergence fails a drift test rather than quietly
 * steering the bot with a model it mis-evaluates.
 */
export function scoreGbdt(artifact: GbdtValueArtifact, x: ArrayLike<number>): number {
  let z = 0;
  for (const tree of artifact.trees) {
    const { feature, threshold, left, right, value } = tree;
    let i = 0;
    while (feature[i] >= 0) {
      i = x[feature[i]] <= threshold[i] ? left[i] : right[i];
    }
    z += value[i];
  }
  return 1 / (1 + Math.exp(-z));
}

/** Convenience wrapper for name-keyed inputs (drift tests, offline tools).
 *  Absent features score as 0, matching the dense zero-filled training
 *  matrix — the trainer sets `zero_as_missing=false` for the same reason. */
export function scoreGbdtFeatures(
  artifact: GbdtValueArtifact,
  features: Record<string, number>,
): number {
  return scoreGbdt(
    artifact,
    artifact.features.map((n) => features[n] ?? 0),
  );
}

/**
 * Load the board-aware value artifact. Resolution order:
 *   1. `explicitPath` argument (evaluation harnesses / A-B runs)
 *   2. `DEXTER_VALUE_ARTIFACT` env var
 *   3. the registry, iff `models.value` is enabled
 * The first two deliberately bypass the registry so a candidate model can be
 * measured BEFORE it earns promotion.
 */
export function readValueArtifact(explicitPath?: string): ValueArtifact | null {
  const override = explicitPath ?? process.env.DEXTER_VALUE_ARTIFACT;
  let abs: string;
  if (override) {
    abs = path.isAbsolute(override) ? override : path.join(process.cwd(), override);
  } else {
    const entry = readRegistry()?.models?.value;
    if (!entry?.enabled || !entry.artifacts?.path) return null;
    abs = path.join(process.cwd(), entry.artifacts.path);
  }
  try {
    const artifact = JSON.parse(readFileSync(abs, "utf8")) as ValueArtifact;
    if (artifact.model_type === "gbdt") {
      return Array.isArray(artifact.trees) && artifact.trees.length > 0 ? artifact : null;
    }
    if (artifact.model_type !== "logistic_regression") return null;
    if (artifact.features.length !== artifact.coefficients.length) return null;
    return artifact;
  } catch {
    return null;
  }
}

/**
 * StateEvaluator over the plan end state's full board. Precomputes the
 * artifact-feature → state-vector-index map once, then scores straight off
 * the encoded array — this runs for every candidate plan of every turn, so
 * it avoids building a name-keyed object per call.
 *
 * Features the artifact names but the current encoder doesn't produce fall
 * back to the training mean (a zero contribution after standardization),
 * matching scoreFeatures' behaviour for absent inputs.
 */
export function createBoardEvaluator(explicitPath?: string): StateEvaluator | null {
  const artifact = readValueArtifact(explicitPath);
  if (!artifact) return null;
  const nameIndex = new Map(STATE_FEATURE_NAMES.map((n, i) => [n, i]));
  const srcIdx = artifact.features.map((n) => nameIndex.get(n) ?? -1);

  if (artifact.model_type === "gbdt") {
    // A tree routes on exact thresholds, so an unknown feature is not a
    // degraded input — it silently sends every state down a wrong branch.
    // Refuse the model outright rather than score garbage confidently.
    if (srcIdx.some((j) => j < 0)) return null;
    const row = new Float64Array(srcIdx.length);
    return (_snapshot: PlanSnapshot, view) => {
      if (!view) return artifact.global_prior;
      const vec = encodeStateFeatures(view);
      for (let i = 0; i < srcIdx.length; i++) row[i] = vec[srcIdx[i]];
      return scoreGbdt(artifact, row);
    };
  }

  const coef = artifact.coefficients;
  const means = artifact.means;
  const stds = artifact.stds;

  return (_snapshot: PlanSnapshot, view) => {
    if (!view) return artifact.global_prior;
    const vec = encodeStateFeatures(view);
    let z = artifact.intercept;
    for (let i = 0; i < srcIdx.length; i++) {
      const j = srcIdx[i];
      const x = j >= 0 ? vec[j] : means[i];
      z += coef[i] * ((x - means[i]) / (stds[i] || 1));
    }
    return 1 / (1 + Math.exp(-z));
  };
}

/** The original 8-scalar evaluator (winprob artifact), registry-gated. */
export function createSnapshotEvaluator(): StateEvaluator | null {
  const artifact = readWinProbArtifact();
  if (!artifact) return null;
  const prior = artifact.global_prior;
  return (snapshot: PlanSnapshot) =>
    scoreFeatures(artifact, {
      prize_diff: snapshot.prize_diff,
      prizes_total: snapshot.prizes_total,
      turn_number: snapshot.turn_number,
      bench_diff: snapshot.bench_diff,
      hand_diff: snapshot.hand_diff,
      went_first: snapshot.went_first,
      is_player_turn: snapshot.is_player_turn,
      archetype_prior: prior,
    });
}

/**
 * The evaluator the bot actually plays with: board-aware when a value model
 * is available, else the snapshot model, else null (the planner falls back
 * to its built-in heuristicEvaluator). The bot's judgment therefore improves
 * automatically as the training loop promotes better models.
 */
export function createBotEvaluator(): StateEvaluator | null {
  return createBoardEvaluator() ?? createSnapshotEvaluator();
}
