// Free-running simulator (ML pipeline Phase 3). Import from
// "@/lib/engine/sim" — the replay engine barrel stays sim-free so the
// replay path never pays for simulator code.

export { SIM_VERSION, instantiateDeck, SimDeckError } from "./setup";
export type { SimDeck } from "./setup";
export { legalMoves, canPayCost, computeDamage, baseDamage, remainingHp } from "./moves";
export type { SimMove, TurnContext } from "./moves";
export { HeuristicPolicy, promoteBest } from "./policy";
export type { DecisionPolicy } from "./policy";
export { viewFor } from "./view";
export type { PlayerView, OpponentView } from "./view";
export { PlannerPolicy, heuristicEvaluator, buildGhostState } from "./planner";
export type { PlannerParams, PlannerOptions, PlanSnapshot, StateEvaluator } from "./planner";
export { plannerParamsForSkill, plannerParamsFor, DIFFICULTY_SKILL } from "./difficulty";
export type { Difficulty } from "./difficulty";
export { playGame, applyMove, beginTurn, promote, otherActor } from "./driver";
export type { GameOutcome, GameOptions, ApplyOutcome } from "./driver";
export { simulateMatchup } from "./rollout";
export type { SimOptions, SimResult } from "./rollout";
export {
  startGame,
  applyHumanMove,
  rebuildSession,
  humanOptions,
  setupOptions,
  autoSetup,
  isSetupMove,
  IllegalMoveError,
} from "./interactive";
export type {
  GameSession,
  GameTranscript,
  TranscriptMove,
  InteractiveMove,
  SetupMove,
  SessionStatus,
  AiAction,
  StartOptions,
  LoggedTurn,
} from "./interactive";
export { serializeView, describeMove, describePromotion } from "./serialize";
export type { ClientView, ClientCard, ClientMon, ClientBoard } from "./serialize";
export { trainerDiscardCost, trainerDiscardCostByName, TRAINER_EFFECTS } from "./trainers";
export { stadiumHandCost, stadiumTopDecks } from "./stadiums";
export type { PlayTrainerMove } from "./trainers";
export { isLegalHumanMove } from "./validate";
export {
  placeCounters,
  healCounters,
  moveCounters,
  dealRawDamage,
  resolveKnockouts,
  isKnockedOut,
  maxHp,
} from "./damage";
export {
  attackBaseDamage,
  attackEffect,
  attackBenchCounterCount,
  attackBenchDamageTargets,
} from "./attacks";
export { abilityMoves, applyAbility, onEvolve, hasOnEvolveTrigger } from "./abilities";
export type { UseAbilityMove } from "./abilities";
export { energyUnits, totalEnergyUnits } from "./setup";
export { retreatCost, canRetreat, effectiveMaxHp, isTool } from "./tools";
export { benchCap, stadiumMoves, applyStadium, enforceBenchCap } from "./stadiums";
export type { UseStadiumMove } from "./stadiums";
export {
  applyCondition,
  clearConditions,
  cannotAct,
  hasCondition,
  runCheckup,
  attackInflictedConditions,
} from "./conditions";
export { mulberry32, hashSeed, shuffle } from "./rng";
export type { Rng } from "./rng";
