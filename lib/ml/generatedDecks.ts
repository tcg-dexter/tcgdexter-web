// Reading the generated deck pool back out of feature_store.sqlite.
//
// Mirrors lib/ml/communityDecks.ts: the store is the durable home, and the
// self-play CLI treats a generated pool exactly like the meta or community
// pools. Provenance travels WITH the deck — a game row that says "gen:abc123
// lost" is worth nothing without the record of what gen:abc123 changed and
// from what.

import { DatabaseSync } from "node:sqlite";
import type { DeckStats } from "./deckGen/rules";

// The schema moved to corpusStore.ts, which owns every table in the
// self-play corpus — one place to read when asking what the store holds.

export interface StoredGeneratedDeck {
  id: string;
  list: string;
  generator: string;
  parentId: string | null;
  archetype: string | null;
  /** Cards swapped out of the parent (0 for skeleton decks). */
  editDistance: number;
  ops: string[];
  stats: DeckStats | null;
}

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
    // Prefix match: every tool here prints a 12-char hash and a full one is
    // 64, so exact-match meant the id the CLI just handed you was rejected.
    const where = options.runHash ? "WHERE run_hash LIKE ?" : "";
    const params = options.runHash ? [`${options.runHash}%`] : [];
    const rows = db
      .prepare(
        `SELECT id, list, generator, parent_id, archetype, edit_distance, ops_json, stats_json
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
        editDistance: Number(r.edit_distance ?? 0),
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
