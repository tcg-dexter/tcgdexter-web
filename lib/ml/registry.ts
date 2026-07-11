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

export interface MlRegistry {
  schema_version: number;
  updated_at: string;
  models: Record<string, MlRegistryModel>;
}

const REGISTRY_PATH = path.join(process.cwd(), "data", "ml", "registry.json");

export function readRegistry(): MlRegistry | null {
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as MlRegistry;
  } catch {
    return null;
  }
}
