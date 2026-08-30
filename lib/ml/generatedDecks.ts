// Reading the generated deck pool back out of feature_store.sqlite.
//
// Mirrors lib/ml/communityDecks.ts: the store is the durable home, and the
// self-play CLI treats a generated pool exactly like the meta or community
// pools. Provenance travels WITH the deck — a game row that says "gen:abc123
// lost" is worth nothing without the record of what gen:abc123 changed and
// from what.

import { DatabaseSync } from "node:sqlite";
import type { DeckStats } from "./deckGen/rules";

export interface StoredGeneratedDeck {
  id: string;
  list: string;
  generator: string;
  parentId: string | null;
  archetype: string | null;
  ops: string[];
  stats: DeckStats | null;
}

export const GENERATED_DECKS_SCHEMA = `
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
  list TEXT NOT NULL,
  ops_json TEXT NOT NULL,
  stats_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_generated_decks_run ON generated_decks(run_hash);
CREATE INDEX IF NOT EXISTS idx_generated_decks_archetype ON generated_decks(archetype);
`;

/** The generated pool, newest run first. `limit` caps how many come back;
 *  `runHash` pins a specific generation run (reproducible training inputs). */
export function loadGeneratedDecks(
  storePath: string,
  options: { limit?: number; runHash?: string } = {},
): StoredGeneratedDeck[] {
  let db: InstanceType<typeof DatabaseSync>;
  try {
    db = new DatabaseSync(storePath, { readOnly: true });
  } catch {
    return [];
  }
  try {
    const where = options.runHash ? "WHERE run_hash = ?" : "";
    const params = options.runHash ? [options.runHash] : [];
    const rows = db
      .prepare(
        `SELECT id, list, generator, parent_id, archetype, ops_json, stats_json
         FROM generated_decks ${where} ORDER BY created_at DESC, id ASC`,
      )
      .all(...params) as Record<string, unknown>[];
    const out: StoredGeneratedDeck[] = [];
    for (const r of rows) {
      if (options.limit != null && out.length >= options.limit) break;
      out.push({
        id: String(r.id),
        list: String(r.list),
        generator: String(r.generator),
        parentId: r.parent_id == null ? null : String(r.parent_id),
        archetype: r.archetype == null ? null : String(r.archetype),
        ops: safeJson<string[]>(r.ops_json, []),
        stats: safeJson<DeckStats | null>(r.stats_json, null),
      });
    }
    return out;
  } catch {
    // No table yet (a store predating this feature) is not an error.
    return [];
  } finally {
    db.close();
  }
}

function safeJson<T>(raw: unknown, fallback: T): T {
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}
