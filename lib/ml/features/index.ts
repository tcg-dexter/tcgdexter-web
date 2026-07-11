// Feature extraction for the ML pipeline (Phase 1). Pure functions only —
// no Next runtime, no Supabase. Consumed by scripts/ml/extract.ts and the
// (future) coach + simulator inference paths.

export { FEATURE_SCHEMA_VERSION } from "./types";
export type {
  DeckFeatures,
  MatchLogFeatures,
  TurnFeatures,
  MatchLabels,
  TurnQualityFlags,
} from "./types";
export { extractDeckFeatures } from "./deck";
export { extractMatchFeatures } from "./match";
export type { MatchExtraction, TurnExtraction } from "./match";
export { deriveMatchLabels, turnQualityFlags } from "./labels";
export { findInvalidValues, num, numOrNull, bool01, mean } from "./guards";
