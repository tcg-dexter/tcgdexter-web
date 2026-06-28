// Public API for the TCG Dexter game engine.
//
// Replay flow:
//   const parsed = parseBattleLog(raw);
//   const normalized = normalizePerspective(parsed, playerHandle);
//   const result = replay(normalized);
//   result.finalState // GameState after every action applied
//   result.events     // per-action structured diff feed
//   result.diagnostics // log/rule mismatches surfaced during replay

export { replay } from "./replay";
export { applyAction } from "./reducer";
export { buildInitialState } from "./initial";
export {
  hasStandardVariant,
  isBasicPokemon,
  isEnergy,
  isTrainerSubtype,
  lookupCard,
  standardPrintingsOf,
  supertypeOf,
} from "./catalog";
export { ENGINE_VERSION } from "./types";

export type {
  CardInstance,
  EngineAbility,
  EngineAttack,
  EngineCard,
  EngineDiagnostic,
  EngineEvent,
  GameState,
  PlayerSide,
  PokemonInPlay,
  ReplayResult,
  StadiumState,
  TurnState,
  ZoneName,
} from "./types";

export type { ReplayOptions } from "./replay";
