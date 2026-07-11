// Win-probability inference (Phase 2). Scores per-turn game states with
// the logistic-regression artifact trained by dexter-ml and published to
// data/ml/winprob.json (registry-gated). Pure math — no Next runtime.
//
// Cross-language contract: the trainer (dexter-ml/scripts/ml_train_winprob.py)
// and this scorer MUST build the same named feature vector. The artifact
// embeds validation examples (input features + expected probability) so a
// vitest test catches drift; turnFeatureVector is the only TS place the
// mapping lives.

import { readFileSync } from "node:fs";
import path from "node:path";
import { readRegistry } from "./registry";
import type { MatchLogFeatures, TurnFeatures } from "./features";

export interface WinProbValidationExample {
  features: Record<string, number>;
  expected_p: number;
}

export interface WinProbArtifact {
  model_type: "logistic_regression";
  model_version: string;
  trained_at: string;
  feature_schema_version: number;
  n_samples: number;
  n_matches: number;
  data_hash: string;
  /** Ordered feature names; coefficients/means/stds align by index. */
  features: string[];
  means: number[];
  stds: number[];
  coefficients: number[];
  intercept: number;
  l2_lambda: number;
  /** Shrunk historical winrate per deck archetype (the stacked baseline). */
  archetype_priors: Record<string, number>;
  global_prior: number;
  metrics: Record<string, number | null>;
  validation_examples: WinProbValidationExample[];
}

export interface WinProbPoint {
  turn_number: number;
  actor: "player" | "opponent";
  p_win: number;
}

/* ─── Artifact loading ──────────────────────────────────────────── */

/** Load the win-prob artifact iff the registry lists it as enabled.
 *  Null means "no model yet" — callers fall back to heuristics-only. */
export function readWinProbArtifact(): WinProbArtifact | null {
  const registry = readRegistry();
  const entry = registry?.models?.winprob;
  if (!entry?.enabled || !entry.artifacts?.path) return null;
  try {
    const abs = path.join(process.cwd(), entry.artifacts.path);
    const artifact = JSON.parse(readFileSync(abs, "utf8")) as WinProbArtifact;
    if (artifact.model_type !== "logistic_regression") return null;
    if (artifact.features.length !== artifact.coefficients.length) return null;
    return artifact;
  } catch {
    return null;
  }
}

/* ─── Feature vector (must mirror ml_train_winprob.py) ──────────── */

export interface WinProbContext {
  went_first: MatchLogFeatures["went_first"];
  /** Player's deck archetype for the prior lookup; null → global prior. */
  archetype_name: string | null;
}

export function archetypePrior(artifact: WinProbArtifact, name: string | null): number {
  return (name ? artifact.archetype_priors[name] : undefined) ?? artifact.global_prior;
}

export function turnFeatureVector(
  ctx: WinProbContext,
  t: TurnFeatures,
  prior: number,
): Record<string, number> {
  return {
    prize_diff: t.prize_diff,
    prizes_total: t.prizes_player + t.prizes_opponent,
    turn_number: t.turn_number,
    bench_diff: t.bench_player - t.bench_opponent,
    hand_diff: t.hand_player - t.hand_opponent,
    went_first: ctx.went_first ?? 0.5,
    is_player_turn: t.actor === "player" ? 1 : 0,
    archetype_prior: prior,
  };
}

/* ─── Scoring ───────────────────────────────────────────────────── */

export function scoreFeatures(
  artifact: WinProbArtifact,
  features: Record<string, number>,
): number {
  let z = artifact.intercept;
  for (let i = 0; i < artifact.features.length; i++) {
    const raw = features[artifact.features[i]];
    const x = Number.isFinite(raw) ? raw : artifact.means[i];
    const std = artifact.stds[i] || 1;
    z += artifact.coefficients[i] * ((x - artifact.means[i]) / std);
  }
  return 1 / (1 + Math.exp(-z));
}

/** P(player wins) after each playable turn. */
export function winProbCurve(
  artifact: WinProbArtifact,
  ctx: WinProbContext,
  turns: TurnFeatures[],
): WinProbPoint[] {
  const prior = archetypePrior(artifact, ctx.archetype_name);
  return turns.map((t) => ({
    turn_number: t.turn_number,
    actor: t.actor,
    p_win: scoreFeatures(artifact, turnFeatureVector(ctx, t, prior)),
  }));
}
