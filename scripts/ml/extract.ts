// ML feature extraction CLI (Phase 1).
//
// Reads dexter-ml's feature_store.sqlite (the reproducible Phase 0 export)
// and emits model-ready JSONL rows + a manifest:
//
//   decks.jsonl    — one row per saved_deck
//   matches.jsonl  — one row per match (log-derived features when a battle
//                    log exists, stored-column fallback otherwise) + labels.
//                    Includes AI Player games from ai_battles, tagged
//                    source='ai_player' — same format, same code path.
//   turns.jsonl    — one row per playable turn with quality flags
//   manifest.json  — schema/parser/engine versions, store data hash, counts
//
// Usage:
//   npx tsx scripts/ml/extract.ts [--store PATH] [--out DIR]
//                                 [--limit N] [--match-id ID]
//
// Runs outside the Next runtime (plain Node via tsx); reuses the exact same
// parser/engine/analyzer code the app runs so features can never drift.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { parseBattleLog, normalizePerspective, summarize, PARSER_VERSION } from "@/lib/battle-log";
import { replay } from "@/lib/engine";
import { ENGINE_VERSION } from "@/lib/engine/types";
import {
  FEATURE_SCHEMA_VERSION,
  extractDeckFeatures,
  extractMatchFeatures,
  deriveMatchLabels,
  turnQualityFlags,
  findInvalidValues,
  numOrNull,
} from "@/lib/ml/features";
import type { MatchLogFeatures } from "@/lib/ml/features";

/* ─── CLI args ──────────────────────────────────────────────────── */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_STORE = path.resolve(REPO_ROOT, "..", "dexter-ml", "feature_store.sqlite");
const DEFAULT_OUT = path.resolve(REPO_ROOT, "..", "dexter-ml", "artifacts", "features");

function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

const storePath = argValue("--store") ?? DEFAULT_STORE;
const outDir = argValue("--out") ?? DEFAULT_OUT;
const limit = numOrNull(argValue("--limit"));
const onlyMatchId = argValue("--match-id");

/* ─── Row plumbing ──────────────────────────────────────────────── */

type Row = Record<string, unknown>;

const invalidValues: string[] = [];

/** Belt-and-braces: builders already guard NaN, but nothing invalid may
 *  ever reach a JSONL line. Sanitizes in place and records the incident. */
function sanitize(row: Row, context: string): Row {
  const bad = findInvalidValues(row);
  for (const entry of bad) {
    const key = entry.split("=")[0];
    row[key] = null;
    invalidValues.push(`${context}:${entry}`);
  }
  return row;
}

function toJsonl(rows: Row[]): string {
  return rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? String(v) : null);

/** All-null MatchLogFeatures, then overlaid with whatever the import flow
 *  stored on the matches row itself (present for log imports, sparse for
 *  manually logged results). */
function storedColumnFeatures(m: Row): MatchLogFeatures {
  const wentFirst = numOrNull(m.went_first);
  const prizesPlayer = numOrNull(m.prizes_taken_player);
  const prizesOpponent = numOrNull(m.prizes_taken_opponent);
  return {
    went_first: wentFirst === null ? null : wentFirst ? 1 : 0,
    player_mulligans: numOrNull(m.player_mulligans),
    opponent_mulligans: numOrNull(m.opponent_mulligans),
    total_turns: numOrNull(m.total_turns),
    player_turns: null,
    opponent_turns: null,
    first_attack_turn_player: null,
    first_attack_turn_opponent: null,
    first_prize_turn_player: null,
    first_prize_turn_opponent: null,
    prizes_player: prizesPlayer,
    prizes_opponent: prizesOpponent,
    prize_diff:
      prizesPlayer !== null && prizesOpponent !== null ? prizesPlayer - prizesOpponent : null,
    kos_by_player: null,
    kos_by_opponent: null,
    retreats_player: null,
    retreats_opponent: null,
    retreat_energy_discarded_player: null,
    retreat_energy_discarded_opponent: null,
    energy_attached_player: null,
    energy_attached_opponent: null,
    supporters_player: null,
    supporters_opponent: null,
    turns_no_energy_player: null,
    turns_no_supporter_player: null,
    stranded_energy_final_player: null,
    stranded_energy_final_opponent: null,
    avg_prize_diff: null,
    max_prize_lead: null,
    max_prize_deficit: null,
    avg_bench_player: null,
    avg_bench_opponent: null,
    end_reason: str(m.end_reason),
    engine_error_count: null,
    engine_warn_count: null,
    unmatched_line_count: null,
  };
}

/** AI Player games, shaped like a `matches` row.
 *
 *  The mapping is small because the formats already agree: the emitter
 *  (lib/engine/sim/battleLog.ts) writes the same vocabulary the parser
 *  reads, enforced by battleLog.test.ts. What differs is naming
 *  (battle_log vs battle_log_raw, winner vs result) and the fact that the
 *  player's handle lives inside the transcript rather than in a column.
 *
 *  Ids are namespaced `ai:<uuid>` so a battle can never be mistaken for a
 *  match downstream — they are distinct universes of row, and a collision
 *  would silently merge them. */
function loadAiBattles(
  db: InstanceType<typeof DatabaseSync>,
  errors: { kind: string; id: string; error: string }[],
): Row[] {
  let rows: Row[];
  try {
    rows = db.prepare("SELECT * FROM ai_battles ORDER BY id").all();
  } catch {
    // A store exported before dexter-ml schema v3 has no such table. Not an
    // error: older stores are still perfectly extractable.
    return [];
  }
  const out: Row[] = [];
  for (const b of rows) {
    const id = String(b.id);
    let playerHandle: string | null = null;
    try {
      const t = JSON.parse(String(b.transcript ?? "{}")) as {
        handles?: { player?: string };
      };
      playerHandle = t.handles?.player ?? null;
    } catch (e) {
      errors.push({
        kind: "ai_battle_transcript",
        id: `ai:${id}`,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    const winner = str(b.winner);
    out.push({
      id: `ai:${id}`,
      user_id: b.user_id,
      saved_deck_id: b.saved_deck_id,
      source: "ai_player",
      // The log names both players; normalizePerspective needs to know which
      // side is "the player". Without the handle the row still counts, but
      // it cannot be replayed — which is why a bad transcript is recorded
      // as an error above rather than silently skipped.
      player_handle: playerHandle,
      battle_log_raw: b.battle_log,
      // The AI's deck IS the opponent archetype for these games.
      opponent_archetype: b.ai_deck_name,
      result: winner === "user" ? "win" : winner === "ai" ? "loss" : null,
      played_at: b.played_at,
      created_at: b.created_at,
      // Stored-column fallback, for when the replay path can't run.
      went_first: b.user_went_first,
      total_turns: b.turns,
      prizes_taken_player: b.prizes_user,
      prizes_taken_opponent: b.prizes_ai,
      end_reason: b.end_reason,
      player_mulligans: null,
      opponent_mulligans: null,
    });
  }
  return out;
}

/* ─── Main ──────────────────────────────────────────────────────── */

function main(): void {
  const db = new DatabaseSync(storePath, { readOnly: true });
  const meta = Object.fromEntries(
    db.prepare("SELECT key, value FROM meta").all().map((r) => [String(r.key), String(r.value)]),
  );

  if (numOrNull(meta.parser_version) !== PARSER_VERSION) {
    console.warn(
      `[extract] WARNING: store parser_version=${meta.parser_version} != lib PARSER_VERSION=${PARSER_VERSION} — re-run the dexter-ml export`,
    );
  }
  if (numOrNull(meta.engine_version) !== ENGINE_VERSION) {
    console.warn(
      `[extract] WARNING: store engine_version=${meta.engine_version} != lib ENGINE_VERSION=${ENGINE_VERSION} — re-run the dexter-ml export`,
    );
  }

  const errors: { kind: string; id: string; error: string }[] = [];

  /* Decks — one row per saved_deck (deck-versioning was removed 2026-07-19;
   * saved_decks.deck_list/.analysis are now written directly by the app). */
  const deckRows: Row[] = [];
  for (const d of db.prepare("SELECT id, deck_list FROM saved_decks ORDER BY id").all()) {
    const deckId = String(d.id);
    const deckList = str(d.deck_list);
    if (!deckList) continue;
    const context = `saved_deck:${deckId}`;
    try {
      deckRows.push(sanitize({ deck_id: deckId, ...extractDeckFeatures(deckList) }, context));
    } catch (e) {
      errors.push({ kind: "deck_parse", id: context, error: e instanceof Error ? e.message : String(e) });
    }
  }

  /* Matches + turns.
   *
   * Two sources, ONE code path. AI Player games (ai_battles) carry a log in
   * the same TCG Live format as an imported match, so they are shaped into
   * the same row and fed through the identical parse → replay → feature
   * pipeline below. Extracting them separately would let the two drift into
   * incomparable feature sets, which is the failure this avoids; the only
   * difference that survives is `source`, so a trainer can include or
   * exclude them deliberately. */
  let matchQuery = "SELECT * FROM matches ORDER BY id";
  if (onlyMatchId) matchQuery = "SELECT * FROM matches WHERE id = ? ORDER BY id";
  const realMatches = onlyMatchId
    ? db.prepare(matchQuery).all(onlyMatchId)
    : db.prepare(matchQuery).all();
  const aiMatches = onlyMatchId ? [] : loadAiBattles(db, errors);
  const allMatches = [...realMatches, ...aiMatches];
  const matches = limit !== null ? allMatches.slice(0, limit) : allMatches;
  const aiBattleCount = aiMatches.length;

  const matchRows: Row[] = [];
  const turnRows: Row[] = [];
  let matchesWithLog = 0;
  let matchesReplayed = 0;

  for (const m of matches) {
    const matchId = String(m.id);
    const battleLog = str(m.battle_log_raw);
    const playerHandle = str(m.player_handle);
    if (battleLog) matchesWithLog += 1;

    let logFeatures = storedColumnFeatures(m);
    let logFeaturesSource: "replay" | "stored" | null =
      logFeatures.total_turns !== null || logFeatures.went_first !== null ? "stored" : null;
    let logResult: string | null = null;

    if (battleLog && playerHandle) {
      try {
        const normalized = normalizePerspective(parseBattleLog(battleLog), playerHandle);
        const replayResult = replay(normalized);
        const extraction = extractMatchFeatures(normalized, replayResult);
        logFeatures = extraction.match;
        logFeaturesSource = "replay";
        logResult = summarize(normalized).result;
        matchesReplayed += 1;

        for (const turn of extraction.turns) {
          turnRows.push(
            sanitize(
              {
                match_id: matchId,
                ...turn.features,
                ...turnQualityFlags(turn.features, turn.endState),
              },
              `turn:${matchId}#${turn.features.turn_number}`,
            ),
          );
        }
      } catch (e) {
        errors.push({
          kind: "match_replay",
          id: matchId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const labels = deriveMatchLabels(str(m.result), logResult, logFeatures.prize_diff);
    matchRows.push(
      sanitize(
        {
          match_id: matchId,
          user_id: str(m.user_id),
          saved_deck_id: str(m.saved_deck_id),
          source: str(m.source),
          played_at: str(m.played_at),
          opponent_archetype: str(m.opponent_archetype),
          has_log: battleLog ? 1 : 0,
          log_features_source: logFeaturesSource,
          ...logFeatures,
          ...labels,
        },
        `match:${matchId}`,
      ),
    );
  }

  /* Write artifacts. */
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "decks.jsonl"), toJsonl(deckRows));
  writeFileSync(path.join(outDir, "matches.jsonl"), toJsonl(matchRows));
  writeFileSync(path.join(outDir, "turns.jsonl"), toJsonl(turnRows));

  const manifest = {
    feature_schema_version: FEATURE_SCHEMA_VERSION,
    parser_version: PARSER_VERSION,
    engine_version: ENGINE_VERSION,
    generated_at: new Date().toISOString(),
    store: {
      path: storePath,
      data_hash: meta.data_hash ?? null,
      exported_at: meta.exported_at ?? null,
      parser_version: numOrNull(meta.parser_version),
      engine_version: numOrNull(meta.engine_version),
    },
    counts: {
      decks: deckRows.length,
      matches: matchRows.length,
      // Split out, because "matches: 300" means something very different
      // when 250 of them are self-play against our own bot.
      matches_real: matchRows.length - aiBattleCount,
      matches_ai_player: aiBattleCount,
      matches_with_log: matchesWithLog,
      matches_replayed: matchesReplayed,
      turns: turnRows.length,
    },
    invalid_value_count: invalidValues.length,
    invalid_values: invalidValues.slice(0, 50),
    error_count: errors.length,
    errors: errors.slice(0, 50),
  };
  writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  db.close();

  console.log(
    `[extract] schema v${FEATURE_SCHEMA_VERSION} parser v${PARSER_VERSION} engine v${ENGINE_VERSION} ` +
      `store_hash=${(meta.data_hash ?? "?").slice(0, 12)}`,
  );
  console.log(
    `[extract] decks=${deckRows.length} matches=${matchRows.length} ` +
      `(with_log=${matchesWithLog}, replayed=${matchesReplayed}) turns=${turnRows.length}`,
  );
  if (invalidValues.length) {
    console.warn(`[extract] sanitized ${invalidValues.length} invalid values (see manifest)`);
  }
  if (errors.length) {
    console.warn(`[extract] ${errors.length} row errors (see manifest):`);
    for (const err of errors.slice(0, 10)) console.warn(`  - ${err.kind} ${err.id}: ${err.error}`);
  }
  console.log(`[extract] wrote ${outDir}`);
}

main();
