import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Model registry — current-model state published by dexter-ml's training
 * pipeline into data/ml/registry.json (same git-push idiom as the other
 * data/ artifacts). Absent until the first training run promotes a model;
 * readers must treat null as "no models yet".
 */

export interface MlRegistryModel {
  model_version: string;
  trained_at: string;
  n_samples: number;
  data_hash: string;
  parser_version: number;
  engine_version: number;
  metrics: Record<string, number | null>;
  artifacts: { path: string; sha256: string } | null;
  /** Serving traffic (admin-gated surfaces may still hide it from users). */
  enabled: boolean;
  /** Passed promotion checks but held behind the admin gate. */
  gated: boolean;
}

/** Data-volume gate: which learned components the corpus currently
 *  supports (spec thresholds). Written by every training run. */
export interface MlRegistryGate {
  enabled: boolean;
  threshold_battles: number;
  n_battles: number;
}

export interface MlRegistry {
  schema_version: number;
  updated_at: string;
  models: Record<string, MlRegistryModel>;
  /** Absent in registries written before Phase 4. */
  gates?: Record<string, MlRegistryGate>;
}

const REGISTRY_PATH = path.join(process.cwd(), "data", "ml", "registry.json");

export function readRegistry(): MlRegistry | null {
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as MlRegistry;
  } catch {
    return null;
  }
}

const warned = new Set<string>();

/** An artifact the caller expected to use turned out to be unusable.
 *
 *  Every consumer of these artifacts degrades quietly by design — null means
 *  "no model yet" and callers fall back to heuristics. That makes a PACKAGING
 *  failure indistinguishable from an untrained model, and it can sit in
 *  production indefinitely: data/ml/value.json was missing from every Vercel
 *  lambda (nothing static points at it, so file tracing dropped it) and the
 *  only symptom was a coach route returning 503 and an AI opponent quietly
 *  playing on heuristics.
 *
 *  Deliberately NOT called when the registry says a model is disabled: that
 *  is a normal state, and those callers return before ever touching a file.
 *  This is only for "we meant to load this and could not".
 *
 *  Deduped on the resolved path — one line per distinct broken artifact per
 *  process. In production there is exactly one path, so exactly one line;
 *  these sit on hot paths and must not spam a busy lambda. */
export function warnArtifactUnusable(
  model: string,
  abs: string,
  reason: string,
): void {
  if (warned.has(abs)) return;
  warned.add(abs);
  console.warn(
    `[ml] ${model} artifact at ${abs} is unusable: ${reason} — falling back.`,
  );
}
