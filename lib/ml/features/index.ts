// Feature extraction for the ML pipeline (Phase 1). Pure functions only —
// no Next runtime, no Supabase. Consumed by scripts/ml/extract.ts and the
// (future) coach + simulator inference paths.

export { FEATURE_SCHEMA_VERSION } from "./types";
export type {
  DeckFeatures,
  BattleLogFeatures,
  TurnFeatures,
  BattleLabels,
  TurnQualityFlags,
} from "./types";
export { extractDeckFeatures } from "./deck";
export { extractBattleFeatures } from "./battle";
export type { BattleExtraction, TurnExtraction } from "./battle";
export { deriveBattleLabels, turnQualityFlags } from "./labels";
export { findInvalidValues, num, numOrNull, bool01, mean } from "./guards";
export {
  POLICY_SCHEMA_VERSION,
  POLICY_TOP_CARDS,
  STATE_FEATURE_NAMES,
  ACTION_FEATURE_NAMES,
  encodeStateFeatures,
  encodeActionFeatures,
} from "./policy";
