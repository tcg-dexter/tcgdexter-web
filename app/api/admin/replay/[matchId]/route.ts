import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildReplayPayload } from "@/lib/replay/frames";

/**
 * GET /api/admin/replay/[matchId]
 *
 * Admin-only. Any match, no visibility rules — the tool exists to inspect
 * arbitrary logs. Frame building itself lives in lib/replay/frames so the
 * public battles endpoint renders exactly the same board.
 */

interface MatchRow {
  id: string;
  battle_log_raw: string | null;
  player_handle: string | null;
  opponent_handle: string | null;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ matchId: string }> },
) {
  const { matchId } = await ctx.params;
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

  const { data: match } = await supabase
    .from("matches")
    .select("id, battle_log_raw, player_handle, opponent_handle")
    .eq("id", matchId)
    .maybeSingle<MatchRow>();
  if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });
  if (!match.battle_log_raw) {
    return NextResponse.json({ error: "Match has no battle log" }, { status: 400 });
  }

  return NextResponse.json(
    buildReplayPayload(match.id, match.battle_log_raw, match.player_handle ?? ""),
  );
}
