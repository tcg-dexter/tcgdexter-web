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

/** Bumped to 5: the attack pattern only matched a trailing WEAKNESS clause,
 *  so a line ending in a Resistance clause ("... took -30 less damage because
 *  of Fighting Resistance.") failed the whole regex and fell through to the
 *  ability pattern, which swallowed the rest of the line into the move name.
 *  Rows stamped 4 or lower carry those attacks as `ability_used` with a
 *  corrupted `ability_name`, and their damage uncounted.
 *
 *  Bumped to 4: a targetless attack ("<handle>'s Fezandipiti ex used Cruel
 *  Arrow.", damage on the following bullets) used to parse as `ability_used`
 *  because it is written exactly like an ability. The parser now asks the
 *  catalog and emits `attack` for moves that are attacks and never
 *  abilities. Rows stamped with version 3 or lower carry those attacks as
 *  abilities, so their damage and attacker attribution are missing.
 *
 *  Bumped to 3: the parser now reads evolutions nested under the trainer
 *  card that caused them ("played Rare Candy." → "- evolved Duskull to
 *  Dusknoir on the Bench."), which were previously dropped. Rows stamped
 *  with version 2 or lower are missing those evolve actions.
 *
 *  Bumped to 2: the parser now reads effect-driven damage-counter lines
 *  ("put a damage counter on", "moved N damage counters from ... to ...")
 *  that were previously dropped on the floor. Rows stamped with version 1
 *  were parsed without them and are missing those actions. */
export const PARSER_VERSION = 5;

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
  | "effect_activated"
  | "knock_out"
  | "prize_taken"
  // Conditions
  | "condition_applied"
  | "damage_counter_placed"
  /** An effect placing one damage counter on each of several Pokémon at
   *  once — Froslass's Freezing Shroud during Pokémon Checkup. One action
   *  per activation, listing every Pokémon hit, rather than one action per
   *  line: the log's own per-line owner attribution is unreliable (see
   *  parse.ts), so the targets can only be resolved as a set. */
  | "damage_counters_placed"
  /** Damage counters moved from one Pokémon to another — Munkidori's
   *  Adrena-Brain. */
  | "damage_counters_moved"
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
  /** Clean card name → TCG Live set/number id, harvested from the verbose
   *  export ("(me2-5_155) N's Zekrom"). Empty for the standard export. Lets
   *  downstream resolution pick the exact printing the player actually used. */
  cardIds: Record<string, string>;
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
