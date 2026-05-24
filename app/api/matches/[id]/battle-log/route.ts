import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/matches/[id]/battle-log
 *
 * Returns the parsed turn + action stream for an owned match. RLS on
 * matches / match_turns / match_actions enforces ownership; the route
 * just shapes the response.
 *
 * Response:
 * {
 *   match: { id, player_handle, opponent_handle, parser_version },
 *   turns: ParsedTurn-like rows ordered by turn_number,
 *   actions: ParsedAction-like rows ordered by sequence
 * }
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { data: match, error: matchErr } = await supabase
    .from("matches")
    .select("id, player_handle, opponent_handle, parser_version, source")
    .eq("id", id)
    .maybeSingle();

  if (matchErr) {
    console.error("[matches/battle-log] match select failed:", matchErr);
    return NextResponse.json({ error: "Failed to load." }, { status: 500 });
  }
  if (!match) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (match.source !== "tcg_live_log") {
    return NextResponse.json(
      { error: "This match has no battle log." },
      { status: 400 },
    );
  }

  const [{ data: turns }, { data: actions }] = await Promise.all([
    supabase
      .from("match_turns")
      .select("id, turn_number, player_turn_number, actor, actor_handle, phase")
      .eq("match_id", id)
      .order("turn_number", { ascending: true }),
    supabase
      .from("match_actions")
      .select("id, turn_id, sequence, actor, action_type, payload, raw_text")
      .eq("match_id", id)
      .order("sequence", { ascending: true }),
  ]);

  return NextResponse.json({
    match: {
      id: match.id,
      player_handle: match.player_handle,
      opponent_handle: match.opponent_handle,
      parser_version: match.parser_version,
    },
    turns: turns ?? [],
    actions: actions ?? [],
  });
}
