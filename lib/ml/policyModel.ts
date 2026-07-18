// Policy-ranker inference. Loads the next-action ranker artifact trained by
// dexter-ml and published to data/ml/policy.json (registry-gated, key
// `models.policy`), and scores encoded (state, action) candidates. Pure
// math — no Next runtime.
//
// Cross-language contract: the trainer and this scorer MUST agree on the
// φ feature construction. Each artifact.features entry names one φ term:
//   * "a:<name>"                — the action feature <name>, verbatim.
//   * "x:<state>|<action>"      — state_value * action_value interaction.
// score_c = Σ_i coef[i] * ((φ_i − means[i]) / (stds[i] || 1)); the policy
// is softmax over candidate scores. There is no intercept and no state-only
// terms — both are constant across a decision's candidates, so they cancel
// in the softmax.
//
// Schema drift fails closed: if the artifact's policy_schema_version or its
// embedded feature-name arrays disagree with the live encoder, the loader
// returns null and callers fall back to the planner. The artifact embeds
// validation examples (sparse inputs + expected scores/probabilities) so a
// vitest test catches drift, same idiom as winprob.ts.

import { readFileSync } from "node:fs";
import path from "node:path";
import { readRegistry } from "./registry";
import {
  ACTION_FEATURE_NAMES,
  POLICY_SCHEMA_VERSION,
  STATE_FEATURE_NAMES,
} from "./features/policy";

export interface PolicyValidationCandidate {
  kind: string;
  /** Sparse action vector: dense index (stringified) → nonzero value. */
  features_sparse: Record<string, number>;
}

export interface PolicyValidationExample {
  /** Sparse state vector: dense index (stringified) → nonzero value. */
  state_sparse: Record<string, number>;
  candidates: PolicyValidationCandidate[];
  expected_scores: number[];
  expected_probabilities: number[];
  /** Index of the move the data-generating policy chose (label, not argmax). */
  chosen_index: number;
}

export interface PolicyRankerArtifact {
  model_type: "policy_ranker";
  model_version: string;
  trained_at: string;
  policy_schema_version: number;
  /** Snapshots of the encoder's name arrays at training time; must equal
   *  the live STATE_FEATURE_NAMES / ACTION_FEATURE_NAMES exactly. */
  state_feature_names: string[];
  action_feature_names: string[];
  /** Ordered φ names ("a:…" / "x:…|…"); the arrays below align by index. */
  features: string[];
  means: number[];
  stds: number[];
  coefficients: number[];
  l2_lambda: number;
  n_decisions: number;
  n_games: number;
  data_hash: string;
  metrics: Record<string, number | null>;
  validation_examples: PolicyValidationExample[];
}

/* ─── φ plan ────────────────────────────────────────────────────── */

/** One φ term, resolved to dense encoder indices. stateIndex −1 means a
 *  pure action term ("a:…"); otherwise state[i] * action[j] ("x:…|…"). */
export interface PhiTerm {
  stateIndex: number;
  actionIndex: number;
}

const STATE_INDEX = new Map(STATE_FEATURE_NAMES.map((n, i) => [n, i] as const));
const ACTION_INDEX = new Map(ACTION_FEATURE_NAMES.map((n, i) => [n, i] as const));

const planCache = new WeakMap<PolicyRankerArtifact, PhiTerm[] | null>();

function namesMatch(artifactNames: unknown, live: readonly string[]): boolean {
  if (!Array.isArray(artifactNames) || artifactNames.length !== live.length) return false;
  for (let i = 0; i < live.length; i++) if (artifactNames[i] !== live[i]) return false;
  return true;
}

function finiteArray(xs: unknown, length: number): xs is number[] {
  return Array.isArray(xs) && xs.length === length && xs.every((x) => Number.isFinite(x));
}

/** Parse artifact.features into an efficient term plan, or null when the
 *  artifact can't be trusted (schema drift, unknown names, misaligned
 *  arrays). Cached per artifact object — the parse happens once. */
export function buildPhiPlan(artifact: PolicyRankerArtifact): PhiTerm[] | null {
  if (planCache.has(artifact)) return planCache.get(artifact) ?? null;
  const plan = buildPhiPlanUncached(artifact);
  planCache.set(artifact, plan);
  return plan;
}

function buildPhiPlanUncached(artifact: PolicyRankerArtifact): PhiTerm[] | null {
  if (artifact.policy_schema_version !== POLICY_SCHEMA_VERSION) return null;
  // The artifact's own name arrays must equal the live encoder's exactly,
  // so a single lookup against the live maps validates a φ name against
  // both at once.
  if (!namesMatch(artifact.state_feature_names, STATE_FEATURE_NAMES)) return null;
  if (!namesMatch(artifact.action_feature_names, ACTION_FEATURE_NAMES)) return null;
  const { features } = artifact;
  if (!Array.isArray(features) || features.length === 0) return null;
  if (!finiteArray(artifact.means, features.length)) return null;
  if (!finiteArray(artifact.stds, features.length)) return null;
  if (!finiteArray(artifact.coefficients, features.length)) return null;

  const plan: PhiTerm[] = [];
  for (const name of features) {
    if (typeof name !== "string") return null;
    if (name.startsWith("a:")) {
      const actionIndex = ACTION_INDEX.get(name.slice(2));
      if (actionIndex === undefined) return null;
      plan.push({ stateIndex: -1, actionIndex });
    } else if (name.startsWith("x:")) {
      const sep = name.indexOf("|");
      if (sep < 0) return null;
      const stateIndex = STATE_INDEX.get(name.slice(2, sep));
      const actionIndex = ACTION_INDEX.get(name.slice(sep + 1));
      if (stateIndex === undefined || actionIndex === undefined) return null;
      plan.push({ stateIndex, actionIndex });
    } else {
      return null;
    }
  }
  return plan;
}

/* ─── Artifact loading ──────────────────────────────────────────── */

/** Structural + φ validation of a parsed artifact JSON. Null = refuse. */
export function validatePolicyArtifact(raw: unknown): PolicyRankerArtifact | null {
  if (raw === null || typeof raw !== "object") return null;
  const artifact = raw as PolicyRankerArtifact;
  if (artifact.model_type !== "policy_ranker") return null;
  if (buildPhiPlan(artifact) === null) return null;
  return artifact;
}

/** Load + validate an artifact from an absolute path (the duel CLI's
 *  registry bypass). Null on any read/parse/validation failure. */
export function readPolicyArtifactFile(absPath: string): PolicyRankerArtifact | null {
  try {
    return validatePolicyArtifact(JSON.parse(readFileSync(absPath, "utf8")));
  } catch {
    return null;
  }
}

/** Load the policy artifact iff the registry lists it as enabled.
 *  Null means "no model yet" — callers fall back to the planner. */
export function readPolicyArtifact(): PolicyRankerArtifact | null {
  const registry = readRegistry();
  const entry = registry?.models?.policy;
  if (!entry?.enabled || !entry.artifacts?.path) return null;
  return readPolicyArtifactFile(path.join(process.cwd(), entry.artifacts.path));
}

/* ─── Scoring ───────────────────────────────────────────────────── */

/** Numerically stable softmax; temperature scales score gaps (τ→0 is
 *  argmax-like, large τ flattens). τ = 1 is the contract's policy. */
export function softmax(scores: number[], temperature = 1): number[] {
  if (scores.length === 0) return [];
  const t = temperature > 0 ? temperature : 1;
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - max) / t));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

/** Score every candidate of one decision. `stateFeatures` is the dense
 *  encodeStateFeatures vector; `candidateFeatures` one dense
 *  encodeActionFeatures vector per legal move. */
export function scoreCandidates(
  artifact: PolicyRankerArtifact,
  stateFeatures: number[],
  candidateFeatures: number[][],
): { scores: number[]; probabilities: number[] } {
  const plan = buildPhiPlan(artifact);
  if (!plan) throw new Error("policy artifact failed φ validation — refusing to score");
  const { means, stds, coefficients } = artifact;
  const scores = candidateFeatures.map((action) => {
    let z = 0;
    for (let i = 0; i < plan.length; i++) {
      const term = plan[i];
      const phi =
        term.stateIndex === -1
          ? action[term.actionIndex]
          : stateFeatures[term.stateIndex] * action[term.actionIndex];
      z += coefficients[i] * ((phi - means[i]) / (stds[i] || 1));
    }
    return z;
  });
  return { scores, probabilities: softmax(scores) };
}
