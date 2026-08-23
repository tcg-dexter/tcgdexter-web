import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildReplayPayload } from "@/lib/replay/frames";

/**
 * GET /api/admin/replay/[battleId]
 *
 * Admin-only. Any battle, no visibility rules — the tool exists to inspect
 * arbitrary logs. Frame building itself lives in lib/replay/frames so the
 * public battles endpoint renders exactly the same board.
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

  return NextResponse.json(
    buildReplayPayload(battle.id, battle.battle_log_raw, battle.player_handle ?? ""),
  );
}
