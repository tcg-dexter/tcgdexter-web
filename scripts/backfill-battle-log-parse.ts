/**
 * backfill-battle-log-parse.ts — re-parse stored TCG Live battle logs.
 *
 * The board rebuilds its frames from `battle_log_raw` on every request, so a
 * parser fix reaches every replay the moment it deploys. The event THREAD
 * doesn't: it reads the `match_turns` / `match_actions` rows written once at
 * import time. Those rows keep whatever the parser understood on the day they
 * were created, which is why a match can show a correct board beside a thread
 * that still has an empty "played Buddy-Buddy Poffin" with no cards under it.
 *
 * This re-runs the current parser over every stored log and rewrites those
 * rows. `parser_version` on the match records which parser produced them, so
 * this only touches what is actually behind.
 *
 * Usage:
 *   npm run backfill:battle-logs                 # dry run — reports, writes nothing
 *   npm run backfill:battle-logs -- --apply      # rewrite the rows
 *   npm run backfill:battle-logs -- --apply --limit 5
 *   npm run backfill:battle-logs -- --apply --match <uuid>
 *
 * Dry run is the DEFAULT, and deliberately so: this deletes and recreates
 * every action row for a match. `--apply` is the only way to write.
 *
 * Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient } from "@supabase/supabase-js";
import {
  PARSER_VERSION,
  normalizePerspective,
  parseBattleLog,
  summarize,
} from "../lib/battle-log";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const LIMIT = numericArg("--limit");
const ONLY_MATCH = stringArg("--match");

function stringArg(flag: string): string | null {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
}
function numericArg(flag: string): number | null {
  const raw = stringArg(flag);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run via:\n" +
      "  node --env-file=.env.local --import tsx scripts/backfill-battle-log-parse.ts",
  );
  process.exit(1);
}
const db = createClient(url, serviceRoleKey, {
  auth: { persistSession: false },
});

interface MatchRow {
  id: string;
  user_id: string;
  battle_log_raw: string;
  player_handle: string | null;
  parser_version: number | null;
  went_first: boolean | null;
  player_mulligans: number | null;
  opponent_mulligans: number | null;
  total_turns: number | null;
  prizes_taken_player: number | null;
  prizes_taken_opponent: number | null;
  end_reason: string | null;
}

/** Fields the parser derives. Everything else on the match — result,
 *  opponent_name, archetype, notes — is the user's and is never touched. */
const DERIVED = [
  "went_first",
  "player_mulligans",
  "opponent_mulligans",
  "total_turns",
  "prizes_taken_player",
  "prizes_taken_opponent",
  "end_reason",
] as const;

async function main() {
  let query = db
    .from("matches")
    .select(
      "id, user_id, battle_log_raw, player_handle, parser_version, went_first, player_mulligans, opponent_mulligans, total_turns, prizes_taken_player, prizes_taken_opponent, end_reason",
    )
    .eq("source", "tcg_live_log")
    .not("battle_log_raw", "is", null)
    .order("created_at", { ascending: true });

  if (ONLY_MATCH) query = query.eq("id", ONLY_MATCH);
  // Only what the current parser hasn't already produced. Re-running after a
  // completed pass is therefore a no-op rather than a second rewrite.
  else query = query.or(`parser_version.is.null,parser_version.lt.${PARSER_VERSION}`);
  if (LIMIT) query = query.limit(LIMIT);

  const { data, error } = await query;
  if (error) {
    console.error("Failed to list matches:", error.message);
    process.exit(1);
  }
  const matches = (data ?? []) as MatchRow[];

  console.log(
    `${APPLY ? "APPLYING" : "DRY RUN"} · parser v${PARSER_VERSION} · ${matches.length} match(es) to re-parse\n`,
  );

  let rewritten = 0;
  let skipped = 0;
  let failed = 0;
  let actionsBefore = 0;
  let actionsAfter = 0;
  const summaryChanges: string[] = [];

  for (const m of matches) {
    const handle = m.player_handle;
    if (!handle) {
      console.warn(`skip ${m.id}: no player_handle recorded`);
      skipped++;
      continue;
    }

    // Parse and build every row BEFORE touching the database. A log the
    // current parser chokes on must leave the existing thread alone rather
    // than deleting it and failing halfway through the rebuild.
    let turnRows: Record<string, unknown>[];
    let buildActionRows: (turnIds: Map<number, string>) => Record<string, unknown>[];
    let derived: Record<string, unknown>;
    let actionCount: number;
    try {
      const parsed = parseBattleLog(m.battle_log_raw);
      if (!parsed.handles.includes(handle)) {
        console.warn(
          `skip ${m.id}: stored handle "${handle}" not found in the log (handles: ${parsed.handles.join(", ")})`,
        );
        skipped++;
        continue;
      }
      const normalized = normalizePerspective(parsed, handle);
      const summary = summarize(normalized);
      actionCount = normalized.actions.length;

      turnRows = normalized.turns.map((t) => ({
        match_id: m.id,
        user_id: m.user_id,
        turn_number: t.turn_number,
        player_turn_number: t.player_turn_number,
        actor: t.actor,
        actor_handle: t.actor_handle,
        phase: t.phase,
      }));

      buildActionRows = (turnIds) => {
        const actionTurnId: (string | null)[] = new Array(
          normalized.actions.length,
        ).fill(null);
        for (const t of normalized.turns) {
          const tid = turnIds.get(t.turn_number);
          if (!tid) continue;
          for (const idx of t.action_indices) actionTurnId[idx] = tid;
        }
        return normalized.actions.map((a, idx) => ({
          match_id: m.id,
          user_id: m.user_id,
          turn_id: actionTurnId[idx],
          sequence: idx,
          actor: a.actor,
          action_type: a.action_type,
          payload: a.payload,
          raw_text: a.raw_text,
        }));
      };

      derived = {
        went_first: summary.went_first,
        player_mulligans: summary.player_mulligans,
        opponent_mulligans: summary.opponent_mulligans,
        total_turns: summary.total_turns,
        prizes_taken_player: summary.prizes_taken_player,
        prizes_taken_opponent: summary.prizes_taken_opponent,
        end_reason: summary.end_reason,
      };
    } catch (e) {
      console.error(`FAIL ${m.id}: parse threw —`, e instanceof Error ? e.message : e);
      failed++;
      continue;
    }

    const { count: before } = await db
      .from("match_actions")
      .select("id", { count: "exact", head: true })
      .eq("match_id", m.id);
    actionsBefore += before ?? 0;
    actionsAfter += actionCount;

    // A derived field moving is worth seeing: these should be stable across a
    // parser change that only adds actions, so a change here means the fix
    // altered something the match summary is built on.
    const moved = DERIVED.filter(
      (k) => JSON.stringify(m[k]) !== JSON.stringify(derived[k]),
    );
    if (moved.length > 0) {
      summaryChanges.push(
        `  ${m.id}: ${moved.map((k) => `${k} ${JSON.stringify(m[k])} → ${JSON.stringify(derived[k])}`).join(", ")}`,
      );
    }

    const delta = actionCount - (before ?? 0);
    console.log(
      `${APPLY ? "rewrite" : "would rewrite"} ${m.id}  actions ${before ?? 0} → ${actionCount} (${delta >= 0 ? "+" : ""}${delta})`,
    );

    if (!APPLY) continue;

    // Actions first, explicitly. match_actions.turn_id cascades from
    // match_turns, but a setup action has no turn — deleting only the turns
    // would strand every pre-turn action from the old parse.
    const delActions = await db.from("match_actions").delete().eq("match_id", m.id);
    if (delActions.error) {
      console.error(`FAIL ${m.id}: delete actions —`, delActions.error.message);
      failed++;
      continue;
    }
    const delTurns = await db.from("match_turns").delete().eq("match_id", m.id);
    if (delTurns.error) {
      console.error(`FAIL ${m.id}: delete turns —`, delTurns.error.message);
      failed++;
      continue;
    }

    const { data: insertedTurns, error: turnsError } = await db
      .from("match_turns")
      .insert(turnRows)
      .select("id, turn_number");
    if (turnsError) {
      console.error(`FAIL ${m.id}: insert turns —`, turnsError.message);
      failed++;
      continue;
    }
    const turnIds = new Map<number, string>();
    for (const t of insertedTurns ?? []) {
      turnIds.set(t.turn_number as number, t.id as string);
    }

    const actionRows = buildActionRows(turnIds);
    let insertFailed = false;
    // Same chunking as the import route: PostgREST has a soft payload cap.
    const CHUNK = 500;
    for (let i = 0; i < actionRows.length; i += CHUNK) {
      const { error: actionsError } = await db
        .from("match_actions")
        .insert(actionRows.slice(i, i + CHUNK));
      if (actionsError) {
        console.error(`FAIL ${m.id}: insert actions —`, actionsError.message);
        insertFailed = true;
        break;
      }
    }
    if (insertFailed) {
      failed++;
      continue;
    }

    // Stamped last. If anything above failed the match keeps its old version
    // and the next run picks it up again.
    const { error: updateError } = await db
      .from("matches")
      .update({ ...derived, parser_version: PARSER_VERSION })
      .eq("id", m.id);
    if (updateError) {
      console.error(`FAIL ${m.id}: update match —`, updateError.message);
      failed++;
      continue;
    }
    rewritten++;
  }

  console.log(
    `\n${APPLY ? "rewritten" : "would rewrite"}: ${APPLY ? rewritten : matches.length - skipped - failed} · skipped: ${skipped} · failed: ${failed}`,
  );
  console.log(`action rows ${actionsBefore} → ${actionsAfter} (${actionsAfter - actionsBefore >= 0 ? "+" : ""}${actionsAfter - actionsBefore})`);
  if (summaryChanges.length > 0) {
    console.log(`\nmatch summary fields that moved (${summaryChanges.length}):`);
    for (const line of summaryChanges) console.log(line);
  } else {
    console.log("no match summary fields changed");
  }
  if (!APPLY) console.log("\nnothing was written — re-run with --apply");
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
