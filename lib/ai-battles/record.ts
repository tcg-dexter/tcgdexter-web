// Persist a finished AI Player game.
//
// Called from POST /api/play the moment a session reaches "over", so
// recording is a property of the SERVER rather than something the client
// has to remember to do — a client that closes the tab on the winning move
// still leaves a row behind.
//
// Two artifacts are stored, and both earn their place:
//   * battle_log — TCG Live format. Readable by a person, parseable by
//     lib/battle-log/parse.ts, and therefore consumable by the existing ML
//     feature pipeline with no new ingest path. Survives engine changes.
//   * transcript — {seed, decks, skill, moves[]}. Replays the exact game,
//     but only while sim_version matches the running engine.

import type { SupabaseClient } from "@supabase/supabase-js";
import { battleLogText, SIM_VERSION, type GameSession } from "@/lib/engine/sim";
import { readRegistry } from "@/lib/ml/registry";

/** Client-supplied labels. Display-only, so they are length-capped rather
 *  than validated — they never drive a query or a permission decision. */
export interface BattleMeta {
  userDeckName?: string | null;
  aiDeckName?: string | null;
  savedDeckId?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const label = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null;

/** Which value model the bot is playing with, so a row can be attributed to
 *  the bot that produced it. Null before the first promotion, and null-safe
 *  because the registry is a data file that may simply not be there. */
function activeValueModelVersion(): string | null {
  const reg = readRegistry();
  const value = reg?.models?.value;
  return value?.enabled ? value.model_version : null;
}

export interface AiBattleRow {
  user_id: string;
  seed: number;
  user_deck_list: string;
  ai_deck_list: string;
  saved_deck_id: string | null;
  user_deck_name: string | null;
  ai_deck_name: string | null;
  battle_log: string;
  transcript: unknown;
  winner: "user" | "ai" | null;
  end_reason: string | null;
  turns: number | null;
  prizes_user: number | null;
  prizes_ai: number | null;
  user_went_first: boolean;
  sim_version: number;
  skill: number;
  model_version: string | null;
}

/** Shape the row. Pure, so it can be asserted without a database. */
export function buildAiBattleRow(
  session: GameSession,
  userId: string,
  meta: BattleMeta = {},
): AiBattleRow {
  const t = session.transcript;
  const o = session.outcome;
  return {
    user_id: userId,
    seed: t.seed,
    user_deck_list: t.deck_human,
    ai_deck_list: t.deck_ai,
    // A malformed id would make the column useless for grouping AND could
    // surface as a Postgres type error on insert; drop it instead.
    saved_deck_id:
      typeof meta.savedDeckId === "string" && UUID_RE.test(meta.savedDeckId)
        ? meta.savedDeckId
        : null,
    user_deck_name: label(meta.userDeckName),
    ai_deck_name: label(meta.aiDeckName),
    battle_log: battleLogText(session),
    transcript: t,
    // The engine says "player"/"opponent"; the row says whose game it was.
    winner: o?.winner == null ? null : o.winner === "player" ? "user" : "ai",
    end_reason: o?.endReason ?? null,
    turns: o?.turns ?? null,
    prizes_user: o?.prizesTaken.player ?? null,
    prizes_ai: o?.prizesTaken.opponent ?? null,
    user_went_first: t.human_first,
    sim_version: SIM_VERSION,
    skill: t.skill,
    model_version: activeValueModelVersion(),
  };
}

/**
 * Write the row, idempotently.
 *
 * Uses the SERVICE-ROLE client: the table has no UPDATE policy (a played
 * game should not be editable by its subject), but /api/play replays the
 * transcript on every request, so the same finished game can arrive more
 * than once and the write has to be an upsert. `user_id` is taken from the
 * authenticated session, never from the request body.
 *
 * Failure is logged and swallowed. Recording is a side effect of finishing
 * a game — losing the row is bad, but failing the player's final move
 * because telemetry is down is worse.
 */
export async function recordAiBattle(
  admin: SupabaseClient,
  session: GameSession,
  userId: string,
  meta: BattleMeta = {},
): Promise<void> {
  if (session.status !== "over") return;
  try {
    const { error } = await admin
      .from("ai_battles")
      // Full unique index on (user_id, seed) — a PARTIAL one cannot be
      // inferred here and raises 42P10 (see CLAUDE.md).
      .upsert(buildAiBattleRow(session, userId, meta), { onConflict: "user_id,seed" });
    if (error) console.error("[ai-battles] insert failed:", error.message);
  } catch (e) {
    console.error("[ai-battles] insert threw:", e);
  }
}
