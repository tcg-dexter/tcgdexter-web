// ML feature-row schemas (Phase 1 of the ML pipeline).
//
// These are the model-ready shapes emitted by `scripts/ml/extract.ts` and
// consumed by dexter-ml's training jobs. The schema is versioned: any
// breaking change to a row shape (removed/renamed field, changed meaning)
// MUST bump FEATURE_SCHEMA_VERSION so training runs can refuse mixed
// corpora. Additive nullable fields don't need a bump.
//
// Design rules:
//   * Flat rows — one JSONL line per row, no nesting beyond primitives.
//     Trainers shouldn't need to unnest anything.
//   * Numeric fields are always finite numbers or null, never NaN /
//     Infinity / undefined (see guards.ts). Booleans are encoded 0 | 1.
//   * Perspective is always the deck owner ("player" in the normalized
//     battle log). Opponent-side aggregates are features about the game,
//     not a second training row.

export const FEATURE_SCHEMA_VERSION = 1;

/* ─── Deck features ─────────────────────────────────────────────── */

/** Pure output of extractDeckFeatures — identity columns (deck id /
 *  version id) are attached by the extract CLI, which knows the source. */
export interface DeckFeatures {
  deck_size: number;
  pokemon_count: number;
  trainer_count: number;
  energy_count: number;
  pokemon_ratio: number;
  trainer_ratio: number;
  energy_ratio: number;
  unique_species: number;
  basic_count: number;
  stage1_count: number;
  stage2_count: number;
  ability_count: number;
  attack_count: number;
  supporter_count: number;
  item_count: number;
  tool_count: number;
  stadium_count: number;
  unique_trainers: number;
  basic_energy_count: number;
  special_energy_count: number;
  energy_type_count: number;
  rotation_ready: 0 | 1;
  rotating_count: number;
  meta_matched: 0 | 1;
  archetype_id: string | null;
  archetype_name: string | null;
  meta_match_pct: number | null;
  meta_rank: number | null;
  meta_conversion_rate: number | null;
  score_total: number | null;
  score_rotation: number | null;
  score_consistency: number | null;
  score_evolution: number | null;
  score_energy_fit: number | null;
  deck_price: number;
}

/* ─── Battle features ───────────────────────────────────────────── */

/** Aggregates derived by folding replay() over a normalized battle log.
 *  All fields are null when the battle has no parseable log. */
export interface BattleLogFeatures {
  went_first: 0 | 1 | null;
  player_mulligans: number | null;
  opponent_mulligans: number | null;
  total_turns: number | null;
  player_turns: number | null;
  opponent_turns: number | null;
  /** Global turn number of the side's first attack; null if it never attacked. */
  first_attack_turn_player: number | null;
  first_attack_turn_opponent: number | null;
  /** Global turn number of the side's first prize; null if none taken. */
  first_prize_turn_player: number | null;
  first_prize_turn_opponent: number | null;
  prizes_player: number | null;
  prizes_opponent: number | null;
  /** player - opponent at game end. */
  prize_diff: number | null;
  /** KOs scored (opponent's Pokémon knocked out) / conceded. */
  kos_by_player: number | null;
  kos_by_opponent: number | null;
  retreats_player: number | null;
  retreats_opponent: number | null;
  /** Energies discarded paying retreat costs. */
  retreat_energy_discarded_player: number | null;
  retreat_energy_discarded_opponent: number | null;
  energy_attached_player: number | null;
  energy_attached_opponent: number | null;
  supporters_player: number | null;
  supporters_opponent: number | null;
  /** Player turns that ended with no energy attached / no supporter. */
  turns_no_energy_player: number | null;
  turns_no_supporter_player: number | null;
  /** Energy sitting on benched Pokémon when the game ended. */
  stranded_energy_final_player: number | null;
  stranded_energy_final_opponent: number | null;
  /** Mean / extremes of (player - opponent) prizes across end-of-turn snapshots. */
  avg_prize_diff: number | null;
  max_prize_lead: number | null;
  max_prize_deficit: number | null;
  avg_bench_player: number | null;
  avg_bench_opponent: number | null;
  end_reason: string | null;
  /** Data-quality signals — training can filter on these. */
  engine_error_count: number | null;
  engine_warn_count: number | null;
  unmatched_line_count: number | null;
}

/* ─── Per-turn features ─────────────────────────────────────────── */

/** One row per playable turn (ParsedTurn with phase === "turn"),
 *  describing what the acting side did plus the end-of-turn board. */
export interface TurnFeatures {
  turn_number: number;
  player_turn_number: number | null;
  /** Whose turn it was. */
  actor: "player" | "opponent";
  attacked: 0 | 1;
  attack_damage: number;
  energy_attached: number;
  supporter_played: 0 | 1;
  items_played: number;
  tools_played: number;
  stadium_played: 0 | 1;
  evolutions: number;
  retreats: number;
  retreat_energy_discarded: number;
  abilities_used: number;
  kos_scored: number;
  prizes_taken: number;
  /** End-of-turn snapshot (after the turn's last parsed action). */
  prizes_player: number;
  prizes_opponent: number;
  prize_diff: number;
  bench_player: number;
  bench_opponent: number;
  hand_player: number;
  /** How many of the player's hand cards are name-resolved. Standard TCG
   *  Live exports never name drawn cards (this stays 0); verbose exports
   *  do. Hand-aware flags (missed_evolution) are only observable when
   *  this is > 0 — training must not read structural zeros as "clean". */
  hand_player_known: number;
  hand_opponent: number;
  /** Acting side's bench-size change across the turn. */
  bench_delta: number;
}

/* ─── Labels ────────────────────────────────────────────────────── */

/** Battle-level training labels. */
export interface BattleLabels {
  /** 1 = win, 0 = loss, 0.5 = draw/tie, null = unknown. */
  outcome: number | null;
  /** Where the outcome came from: the stored matches.result ("stored")
   *  or the re-parsed log summary ("log"). */
  outcome_source: "stored" | "log" | null;
  /** Final prizes_player - prizes_opponent (null without a log or stored counts). */
  label_prize_diff: number | null;
}

/** Deterministic, explainable turn-quality flags (heuristics — these are
 *  weak labels for the coach, not ground truth). Player turns only carry
 *  hand-aware flags; the opponent's hand contents are unknowable from the
 *  log, so missed_evolution is always 0 on opponent turns. */
export interface TurnQualityFlags {
  flag_missed_energy_attach: 0 | 1;
  flag_no_supporter: 0 | 1;
  flag_over_retreat: 0 | 1;
  flag_passive_turn: 0 | 1;
  flag_missed_evolution: 0 | 1;
}
