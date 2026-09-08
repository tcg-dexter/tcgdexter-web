// The self-play corpus store — generated data, kept apart from the snapshot.
//
// `feature_store.sqlite` is dexter-ml's snapshot of Supabase: ml_export.py
// rewrites its tables every week, and it gets copied around. Self-play data
// has no business living there. It already dominates the file (633 MB of
// policy_candidates + 406 MB of index against 31 MB of actual match data),
// and the corpora this pipeline generates would push a 1.4 GB file past 5 GB.
//
// So generated data lives in its own database. The split also states the
// distinction plainly: one file is a record of what HAPPENED, the other is a
// record of what we SIMULATED, and conflating them is how a training set
// quietly acquires its own outputs.
//
// Two shapes live here, for the two opposite allocations of the same engine:
//
//   matchup_results  — outcome only, ~200 bytes a row. Every pair a study
//                      ran. Cheap enough that a 100k-pair study is a rounding
//                      error, which is what makes the panel design possible.
//   policy_*         — per-decision records for training. ~38 KB a game
//                      (decisions) or ~131 KB (with candidates), which is why
//                      recording granularity is a flag and not an assumption.

import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Default location: alongside the feature store in the dexter-ml repo,
 *  which is already gitignored and already where trainers look. */
export function defaultCorpusPath(repoRoot: string): string {
  return path.resolve(repoRoot, "..", "dexter-ml", "selfplay_corpus.sqlite");
}

export const CORPUS_SCHEMA = `
CREATE TABLE IF NOT EXISTS matchup_studies (
  study_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  -- NULL until every pair is in. Written at START, not at the end: a study
  -- that runs for hours will sometimes be interrupted, and rows with no
  -- study row are orphans that nothing downstream can find.
  completed_at TEXT,
  mode TEXT NOT NULL,
  sim_version INTEGER NOT NULL,
  engine_version INTEGER NOT NULL,
  seed TEXT NOT NULL,
  games_per_pair INTEGER NOT NULL,
  pairs INTEGER NOT NULL,
  games INTEGER NOT NULL,
  skill REAL NOT NULL,
  shards INTEGER NOT NULL,
  elapsed_ms INTEGER NOT NULL,
  params_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS matchup_results (
  study_id TEXT NOT NULL,
  pair_index INTEGER NOT NULL,
  deck_a TEXT NOT NULL,
  deck_b TEXT NOT NULL,
  deck_a_source TEXT NOT NULL,
  deck_b_source TEXT NOT NULL,
  n INTEGER NOT NULL,
  wins_a INTEGER NOT NULL,
  wins_b INTEGER NOT NULL,
  draws INTEGER NOT NULL,
  avg_prize_diff_a REAL NOT NULL,
  avg_turns REAL NOT NULL,
  end_reasons_json TEXT NOT NULL,
  seed INTEGER NOT NULL,
  PRIMARY KEY (study_id, pair_index)
);
CREATE INDEX IF NOT EXISTS idx_matchup_results_a ON matchup_results(study_id, deck_a);
CREATE INDEX IF NOT EXISTS idx_matchup_results_b ON matchup_results(study_id, deck_b);

CREATE TABLE IF NOT EXISTS policy_runs (
  run_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  policy_schema_version INTEGER NOT NULL,
  engine_version INTEGER NOT NULL,
  sim_version INTEGER NOT NULL,
  seed INTEGER NOT NULL,
  games INTEGER NOT NULL,
  params_json TEXT NOT NULL,
  state_feature_names TEXT NOT NULL,
  action_feature_names TEXT NOT NULL,
  decisions INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS policy_games (
  run_hash TEXT NOT NULL,
  game_index INTEGER NOT NULL,
  seed INTEGER NOT NULL,
  deck_a TEXT NOT NULL,
  deck_b TEXT NOT NULL,
  deck_a_source TEXT,
  deck_b_source TEXT,
  skill_a REAL NOT NULL,
  skill_b REAL NOT NULL,
  winner TEXT,
  end_reason TEXT NOT NULL,
  turns INTEGER NOT NULL,
  decisions INTEGER NOT NULL,
  PRIMARY KEY (run_hash, game_index)
);
CREATE TABLE IF NOT EXISTS policy_decisions (
  run_hash TEXT NOT NULL,
  game_index INTEGER NOT NULL,
  decision_index INTEGER NOT NULL,
  actor TEXT NOT NULL,
  turn_number INTEGER NOT NULL,
  player_turn_number INTEGER NOT NULL,
  skill REAL NOT NULL,
  chosen_index INTEGER NOT NULL,
  chosen_kind TEXT NOT NULL,
  n_candidates INTEGER NOT NULL,
  value_estimate REAL,
  outcome REAL NOT NULL,
  state_sparse TEXT NOT NULL,
  PRIMARY KEY (run_hash, game_index, decision_index)
);
CREATE TABLE IF NOT EXISTS policy_candidates (
  run_hash TEXT NOT NULL,
  game_index INTEGER NOT NULL,
  decision_index INTEGER NOT NULL,
  candidate_index INTEGER NOT NULL,
  kind TEXT NOT NULL,
  features_sparse TEXT NOT NULL,
  PRIMARY KEY (run_hash, game_index, decision_index, candidate_index)
);

CREATE TABLE IF NOT EXISTS generated_deck_runs (
  run_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  gen_version INTEGER NOT NULL,
  sim_version INTEGER NOT NULL,
  engine_version INTEGER NOT NULL,
  seed INTEGER NOT NULL,
  requested INTEGER NOT NULL,
  produced INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  params_json TEXT NOT NULL,
  rejected_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS generated_decks (
  id TEXT PRIMARY KEY,
  run_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  generator TEXT NOT NULL,
  parent_id TEXT,
  archetype TEXT,
  seed INTEGER NOT NULL,
  edit_distance INTEGER NOT NULL DEFAULT 0,
  list TEXT NOT NULL,
  ops_json TEXT NOT NULL,
  stats_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_generated_decks_run ON generated_decks(run_hash);
CREATE INDEX IF NOT EXISTS idx_generated_decks_archetype ON generated_decks(archetype);
CREATE INDEX IF NOT EXISTS idx_generated_decks_parent ON generated_decks(parent_id);
`;

/** Open (creating if needed) the corpus store with the schema applied and
 *  write-ahead logging on — the sharded writers append in bulk, and WAL is
 *  the difference between "a few seconds" and "a few minutes" for that. */
export function openCorpus(dbPath: string): InstanceType<typeof DatabaseSync> {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec(CORPUS_SCHEMA);
  // generated_decks predates edit_distance; CREATE TABLE IF NOT EXISTS will
  // not add a column to a table that already exists.
  for (const alter of [
    "ALTER TABLE generated_decks ADD COLUMN edit_distance INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE matchup_studies ADD COLUMN completed_at TEXT",
  ]) {
    try {
      db.exec(alter);
    } catch (e) {
      if (!(e instanceof Error) || !/duplicate column/i.test(e.message)) throw e;
    }
  }
  return db;
}
