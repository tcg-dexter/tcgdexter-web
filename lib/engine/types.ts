// TCG Dexter game-engine state model.
//
// The engine takes a normalized BattleLogParseResult and folds it over a
// GameState, producing a stream of EngineEvents and (where the log doesn't
// agree with the rules) EngineDiagnostics. v1 is replay-only — the engine
// reflects what the log says happened. A later pass will reuse this state
// shape for free-running simulation with a decision policy on top.
//
// Design rules of thumb:
//   * Cards-in-zones (deck, hand, discard, lost zone, prizes) are tracked
//     as flat arrays of CardInstance. The deck's top is index 0.
//   * Pokémon in play carry their own PokemonInPlay record with damage,
//     attached energy / tools, conditions, and evolution stack. They get
//     a stable instance id so subsequent log lines can refer to "that
//     Frogadier" across turns even when multiple share a name.
//   * Card identity flows through CardInstance.id; CardInstance.catalog
//     is a back-pointer to the catalog row (HP, attacks, etc.) when the
//     name resolves cleanly. Catalog misses are recorded as diagnostics
//     but never block the replay.
//   * Side perspective uses the Actor enum from lib/battle-log/types.ts
//     so the engine speaks the same vocabulary as the parser.

import type { Actor, EndReason, Phase, SpecialCondition } from "@/lib/battle-log/types";

export const ENGINE_VERSION = 1;

/* ─── Card data ─────────────────────────────────────────────────── */

/** Subset of cards-standard.json used by the engine at runtime. */
export interface EngineCard {
  name: string;
  set_id: string;
  number: string;
  supertype: "Pokémon" | "Trainer" | "Energy" | string;
  subtypes: string[];
  types: string[];
  hp: number | null;
  retreat_cost: number;
  evolves_from: string | null;
  weaknesses: { type: string; value: string }[];
  resistances: { type: string; value: string }[];
  attacks: EngineAttack[];
  abilities: EngineAbility[];
  // For Trainers, the rules array carries the card text the engine would
  // execute. Kept raw so the data-driven interpreter (phase 2) can read it.
  rules: string[];
}

export interface EngineAttack {
  name: string;
  cost: string[];
  convertedEnergyCost: number;
  damage: string;
  text: string;
}

export interface EngineAbility {
  name: string;
  type: string;
  text: string;
}

/* ─── Instances + zones ─────────────────────────────────────────── */

/** A single positional copy of a card. Two `Buddy-Buddy Poffin`s in the
 *  same deck have the same `name` but different `id`s. */
export interface CardInstance {
  id: string;
  name: string;
  /** Catalog row if the name resolved, else null (still tracked positionally). */
  catalog: EngineCard | null;
  /** Set when the instance was created from an unrevealed source (deck top,
   *  prize, opponent hand pre-reveal) so the UI can dim it. */
  unrevealed?: boolean;
}

export type ZoneName =
  | "deck"
  | "hand"
  | "discard"
  | "lost_zone"
  | "prizes"
  | "active"
  | "bench"
  | "stadium";

/* ─── In-play Pokémon ───────────────────────────────────────────── */

export interface PokemonInPlay {
  /** Stable id reused across turns. New when first benched / actived. */
  id: string;
  /** Top-of-stack card — the one currently "in play". */
  card: CardInstance;
  /** Stages below (Basic at index 0, Stage 1 at 1, etc., topmost excluded). */
  stack: CardInstance[];
  damage: number;
  attachedEnergy: CardInstance[];
  attachedTools: CardInstance[];
  conditions: SpecialCondition[];
  /** Names of abilities used this turn (for once-per-turn enforcement). */
  abilitiesUsedThisTurn: string[];
  /** Turn number this Pokémon entered play (used for evolution lock). */
  enteredPlayOnTurn: number;
  /** True if this stack started its current top form this same turn. */
  evolvedThisTurn: boolean;
}

/* ─── Player side ───────────────────────────────────────────────── */

export interface PlayerSide {
  handle: string | null;
  deck: CardInstance[];           // index 0 = top
  hand: CardInstance[];
  discard: CardInstance[];
  lostZone: CardInstance[];
  prizes: CardInstance[];         // length decreases as taken
  active: PokemonInPlay | null;
  bench: PokemonInPlay[];
  mulligans: number;
  /** Energy attached so far this turn (1/turn rule). Reset at turn end. */
  energyAttachedThisTurn: number;
  /** Supporter played this turn (1/turn rule). Reset at turn end. */
  supporterPlayedThisTurn: boolean;
}

/* ─── Stadium ───────────────────────────────────────────────────── */

export interface StadiumState {
  card: CardInstance;
  owner: Actor;          // "player" | "opponent" — never "system"
}

/* ─── Turn metadata ─────────────────────────────────────────────── */

export interface TurnState {
  /** 1-indexed global turn counter. Incremented at every turn_start. */
  number: number;
  /** 1-indexed per-actor turn (e.g. opponent's 3rd turn). */
  playerTurnNumber: number;
  /** Whose turn it currently is. "system" during Pokémon Checkup. */
  actor: Actor;
  phase: Phase;
}

/* ─── Top-level GameState ───────────────────────────────────────── */

export interface GameState {
  engineVersion: number;
  turn: TurnState;
  /** Actor who went first. Set when chose_first resolves. */
  firstPlayer: Actor | null;
  stadium: StadiumState | null;
  sides: {
    player: PlayerSide;
    opponent: PlayerSide;
  };
  /** Prizes the actor has taken (out of 6). */
  prizesTaken: {
    player: number;
    opponent: number;
  };
  winner: Actor | null;
  endReason: EndReason | null;
}

/* ─── Reducer outputs ───────────────────────────────────────────── */

/** Structured summary of the state delta produced by one parsed action.
 *  Kept compact so a UI can render a per-action feed without re-diffing. */
export interface EngineEvent {
  /** Index into the original ParsedAction[] for traceability. */
  actionIndex: number;
  /** Mirrors ParsedAction.action_type but stays loose (string) so future
   *  parser additions don't force an engine bump. */
  kind: string;
  actor: Actor;
  summary: string;
  /** Free-form structured detail for downstream consumers. */
  detail: Record<string, unknown>;
}

export type DiagnosticSeverity = "info" | "warn" | "error";

export interface EngineDiagnostic {
  severity: DiagnosticSeverity;
  /** Index into the original ParsedAction[] (or -1 for setup-time issues). */
  actionIndex: number;
  /** Short machine-readable identifier, e.g. "catalog_miss". */
  code: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface ReplayResult {
  /** Initial state + one snapshot per applied action. states[i] is the
   *  state AFTER actions[i] was applied. */
  states: GameState[];
  initialState: GameState;
  events: EngineEvent[];
  diagnostics: EngineDiagnostic[];
  finalState: GameState;
}
