// Battle log event taxonomy.
//
// The parser produces a flat ordered list of ParsedAction. Each action
// carries an action_type, the actor (resolved to player/opponent/system
// during normalization), a typed payload, and the original raw_text so
// downstream code can fall back to the source line.
//
// Action types are deliberately fine-grained so the future coaching
// engine can run queries like "all turns where the player retreated"
// or "all attacks that triggered Powerful Rage". When in doubt, prefer
// adding a new type over overloading an existing one.

export const PARSER_VERSION = 1;

export type Actor = "player" | "opponent" | "system";

export type Location = "active" | "bench" | "stadium" | "discard" | "hand" | "deck" | "prizes" | "lost_zone";

export type SpecialCondition =
  | "Poisoned"
  | "Burned"
  | "Asleep"
  | "Confused"
  | "Paralyzed";

export type EndReason = "prizes" | "no_active" | "deck_out" | "concede";

export type ActionType =
  // Setup
  | "coin_flip"
  | "coin_toss_won"
  | "chose_first"
  | "opening_hand"
  | "mulligan"
  | "mulligan_total"
  | "mulligan_bonus_draw"
  | "play_to_active"
  | "play_to_bench"
  // Turn boundaries
  | "turn_start"
  | "turn_end"
  // Card flow
  | "draw"
  | "discard"
  | "shuffle"
  | "move_to_hand"
  | "add_to_hand"
  | "reveal"
  // Board moves
  | "attach_energy"
  | "play_supporter"
  | "play_item"
  | "play_tool"
  | "play_stadium"
  | "evolve"
  | "retreat"
  | "switch_active"
  // Combat
  | "attack"
  | "ability_used"
  | "damage_dealt"
  | "discard_from_pokemon"
  | "knock_out"
  | "prize_taken"
  // Conditions
  | "condition_applied"
  | "damage_counter_placed"
  // End
  | "game_end"
  // Catch-all
  | "unknown";

export interface ParsedAction {
  action_type: ActionType;
  actor: Actor | null;
  actor_handle: string | null;
  raw_text: string;
  payload: Record<string, unknown>;
}

export type Phase = "setup" | "turn" | "checkup" | "end";

export interface ParsedTurn {
  turn_number: number;            // global, 1-indexed
  player_turn_number: number | null;
  actor: Actor;
  actor_handle: string | null;
  phase: Phase;
  /** Indices into the flat actions array that belong to this turn. */
  action_indices: number[];
}

export interface BattleLogParseResult {
  /** All handles seen in the log, in order of first appearance. */
  handles: string[];
  /** Resolved perspective: which raw handle is the player. Null until normalized. */
  player_handle: string | null;
  opponent_handle: string | null;
  actions: ParsedAction[];
  turns: ParsedTurn[];
  /** Lines the parser couldn't match. Kept so we can improve patterns. */
  unmatched: string[];
  parser_version: number;
}

export interface BattleLogSummary {
  player_handle: string | null;
  opponent_handle: string | null;
  went_first: boolean | null;
  player_mulligans: number;
  opponent_mulligans: number;
  total_turns: number;
  prizes_taken_player: number;
  prizes_taken_opponent: number;
  end_reason: EndReason | null;
  result: "win" | "loss" | "draw" | null;
}
