import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  parseBattleLog,
  normalizePerspective,
  summarize,
  PARSER_VERSION,
} from "@/lib/battle-log";
import { bumpMatchStreak, localDateInTz } from "@/lib/streak";
import { reconcileAchievements } from "@/lib/learn/achievements";

/**
 * POST /api/matches/import
 *
 * Parses a TCG Live battle log paste and persists the result as a
 * match + match_turns + match_actions. The user picks which handle in
 * the log is theirs; everything else is derived.
 *
 * Body: {
 *   saved_deck_id: string (uuid),
 *   battle_log_raw: string,
 *   player_handle: string,           // chosen by the user from detected candidates
 *   result_override?: "win" | "loss" | "draw",  // optional; otherwise derived from log
 *   opponent_archetype?: string,
 *   opponent_name?: string,
 *   notes?: string,
 *   played_at?: string (ISO timestamp; defaults to null)
 * }
 */
export async function POST(req: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  let body: {
    saved_deck_id?: string;
    battle_log_raw?: string;
    player_handle?: string;
    result_override?: string;
    opponent_archetype?: string;
    opponent_name?: string;
    notes?: string;
    played_at?: string;
    /** Client IANA timezone, for bucketing the daily-logging streak. */
    tz?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    saved_deck_id,
    battle_log_raw,
    player_handle,
    result_override,
    opponent_archetype,
    opponent_name,
    notes,
    played_at,
  } = body;

  if (!saved_deck_id) {
    return NextResponse.json({ error: "saved_deck_id is required." }, { status: 400 });
  }
  if (!battle_log_raw || battle_log_raw.trim().length < 50) {
    return NextResponse.json({ error: "battle_log_raw is required." }, { status: 400 });
  }
  if (!player_handle) {
    return NextResponse.json({ error: "player_handle is required." }, { status: 400 });
  }

  const { data: deck } = await supabase
    .from("saved_decks")
    .select("id")
    .eq("id", saved_deck_id)
    .maybeSingle();
  if (!deck) {
    return NextResponse.json({ error: "Deck not found." }, { status: 404 });
  }

  // Parse + normalize + summarize.
  const parsed = parseBattleLog(battle_log_raw);
  if (!parsed.handles.includes(player_handle)) {
    return NextResponse.json(
      { error: "player_handle not found in the log." },
      { status: 400 },
    );
  }
  const normalized = normalizePerspective(parsed, player_handle);
  const summary = summarize(normalized);

  let result = result_override;
  if (!result) result = summary.result ?? undefined;
  if (!result || !["win", "loss", "draw"].includes(result)) {
    return NextResponse.json(
      { error: "Could not determine match result. Please pick win / loss / draw." },
      { status: 400 },
    );
  }

  // Insert match.
  const { data: match, error: matchError } = await supabase
    .from("matches")
    .insert({
      user_id: user.id,
      saved_deck_id,
      result,
      opponent_name: opponent_name?.trim() || summary.opponent_handle || null,
      opponent_archetype: opponent_archetype?.trim() || null,
      opponent_deck_list: null,
      notes: notes?.trim() || null,
      played_at: played_at || null,
      source: "tcg_live_log",
      battle_log_raw,
      player_handle: summary.player_handle,
      opponent_handle: summary.opponent_handle,
      went_first: summary.went_first,
      player_mulligans: summary.player_mulligans,
      opponent_mulligans: summary.opponent_mulligans,
      total_turns: summary.total_turns,
      prizes_taken_player: summary.prizes_taken_player,
      prizes_taken_opponent: summary.prizes_taken_opponent,
      end_reason: summary.end_reason,
      parser_version: PARSER_VERSION,
    })
    .select("id")
    .single();

  if (matchError || !match) {
    console.error("[matches/import] insert match failed:", matchError);
    return NextResponse.json({ error: "Failed to save match." }, { status: 500 });
  }

  // Insert turns; collect ids in order.
  const turnRows = normalized.turns.map((t) => ({
    match_id: match.id,
    user_id: user.id,
    turn_number: t.turn_number,
    player_turn_number: t.player_turn_number,
    actor: t.actor,
    actor_handle: t.actor_handle,
    phase: t.phase,
  }));

  const { data: insertedTurns, error: turnsError } = await supabase
    .from("match_turns")
    .insert(turnRows)
    .select("id, turn_number");

  if (turnsError || !insertedTurns) {
    console.error("[matches/import] insert turns failed:", turnsError);
    // Best-effort rollback: delete the match (cascades).
    await supabase.from("matches").delete().eq("id", match.id);
    return NextResponse.json({ error: "Failed to save turns." }, { status: 500 });
  }

  const turnIdByNumber = new Map<number, string>();
  for (const t of insertedTurns) {
    turnIdByNumber.set(t.turn_number as number, t.id as string);
  }

  // Map each action's containing turn via the action_indices on each ParsedTurn.
  const actionTurnId: (string | null)[] = new Array(normalized.actions.length).fill(null);
  for (const t of normalized.turns) {
    const tid = turnIdByNumber.get(t.turn_number);
    if (!tid) continue;
    for (const idx of t.action_indices) actionTurnId[idx] = tid;
  }

  const actionRows = normalized.actions.map((a, idx) => ({
    match_id: match.id,
    user_id: user.id,
    turn_id: actionTurnId[idx],
    sequence: idx,
    actor: a.actor,
    action_type: a.action_type,
    payload: a.payload,
    raw_text: a.raw_text,
  }));

  if (actionRows.length > 0) {
    // Supabase's PostgREST has a soft limit on payload size; chunk to be safe.
    const CHUNK = 500;
    for (let i = 0; i < actionRows.length; i += CHUNK) {
      const slice = actionRows.slice(i, i + CHUNK);
      const { error: actionsError } = await supabase
        .from("match_actions")
        .insert(slice);
      if (actionsError) {
        console.error("[matches/import] insert actions failed:", actionsError);
        await supabase.from("matches").delete().eq("id", match.id);
        return NextResponse.json({ error: "Failed to save actions." }, { status: 500 });
      }
    }
  }

  // One import = one logged day, same as a manual log. Non-fatal.
  const tz = typeof body.tz === "string" ? body.tz : "UTC";
  const streak = await bumpMatchStreak(supabase, localDateInTz(new Date(), tz), tz);

  // Award badges this import unlocked — a first-ever import earns both
  // First Match and First Battle Log. Internally error-safe.
  await reconcileAchievements(supabase, user.id);

  return NextResponse.json({
    id: match.id,
    result,
    summary,
    unmatched_lines: parsed.unmatched.length,
    streak,
  });
}
