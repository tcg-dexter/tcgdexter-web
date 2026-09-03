import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildReplayPayload } from "@/lib/replay/frames";
import { buildBeats } from "@/lib/replay2/beats";

/**
 * GET /api/admin/replay2/[battleId]
 *
 * Replay 2.0's payload: byte-identical v1 frames plus the beat stream that
 * drives the new viewer's choreography. Same admin gate and same "any battle,
 * no visibility rules" stance as /api/admin/replay/[battleId] — 2.0 lives
 * behind admin tools until it's ready.
 *
 * Deliberately its own route rather than a query flag on the v1 one: the
 * public battles page shares that handler, and Replay 2.0's promise is that
 * nothing production renders changes while it's being built.
 */

interface BattleRow {
  id: string;
  battle_log_raw: string | null;
  player_handle: string | null;
  opponent_handle: string | null;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ battleId: string }> },
) {
  const { battleId } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Auth required" }, { status: 401 });

  const { data: me } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle<{ is_admin: boolean }>();
  if (!me?.is_admin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const { data: battle } = await supabase
    .from("matches")
    .select("id, battle_log_raw, player_handle, opponent_handle")
    .eq("id", battleId)
    .maybeSingle<BattleRow>();
  if (!battle) return NextResponse.json({ error: "Battle not found" }, { status: 404 });
  if (!battle.battle_log_raw) {
    return NextResponse.json({ error: "Battle has no battle log" }, { status: 400 });
  }

  const handle = battle.player_handle ?? "";
  return NextResponse.json({
    ...buildReplayPayload(battle.id, battle.battle_log_raw, handle),
    beats: buildBeats(battle.battle_log_raw, handle),
    battleLogRaw: battle.battle_log_raw,
  });
}
