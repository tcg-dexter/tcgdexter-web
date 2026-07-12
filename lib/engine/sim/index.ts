// Free-running simulator (ML pipeline Phase 3). Import from
// "@/lib/engine/sim" — the replay engine barrel stays sim-free so the
// replay path never pays for simulator code.

export { SIM_VERSION, instantiateDeck, SimDeckError } from "./setup";
export type { SimDeck } from "./setup";
export { legalMoves, canPayCost, computeDamage, baseDamage, remainingHp } from "./moves";
export type { SimMove, TurnContext } from "./moves";
export { HeuristicPolicy } from "./policy";
export type { DecisionPolicy } from "./policy";
export { playGame } from "./driver";
export type { GameOutcome, GameOptions } from "./driver";
export { simulateMatchup } from "./rollout";
export type { SimOptions, SimResult } from "./rollout";
export { mulberry32, hashSeed, shuffle } from "./rng";
export type { Rng } from "./rng";
