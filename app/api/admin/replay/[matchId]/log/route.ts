import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { supporterNames } from "@/lib/supporterNames";

/**
 * GET /api/admin/replay/[matchId]/log
 *
 * Admin-only mirror of /api/battles/[id]/log. Returns the same response
 * shape (so BattleLogDetail can consume either) but skips the public-deck
 * gate — the Replay tool needs to walk any imported match regardless of
 * publish state.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ matchId: string }> },
) {
  const { matchId } = await ctx.params;

  // Admin gate via the user-session client; data fetches go through the
  // admin client so RLS doesn't block reads for matches owned by other
  // accounts.
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

  const admin = createAdminClient();

  const { data: match } = await admin
    .from("matches")
    .select("id, player_handle, opponent_handle, parser_version, source")
    .eq("id", matchId)
    .maybeSingle();

  if (!match) return NextResponse.json({ error: "Not found." }, { status: 404 });

  if ((match.source as string) !== "tcg_live_log") {
    return NextResponse.json({ error: "This match has no battle log." }, { status: 400 });
  }

  const [{ data: turns, error: turnsErr }, { data: actions, error: actionsErr }] =
    await Promise.all([
      admin
        .from("match_turns")
        .select("id, turn_number, player_turn_number, actor, actor_handle, phase")
        .eq("match_id", matchId)
        .order("turn_number", { ascending: true }),
      admin
        .from("match_actions")
        .select("id, turn_id, sequence, actor, action_type, payload, raw_text")
        .eq("match_id", matchId)
        .order("sequence", { ascending: true }),
    ]);

  if (turnsErr || actionsErr) {
    return NextResponse.json({ error: "Failed to load." }, { status: 500 });
  }

  const supporters = supporterNames();
  type ActionRow = { action_type: string; payload: unknown; [key: string]: unknown };
  const taggedActions = (actions ?? []).map((a: ActionRow) => {
    if (a.action_type === "play_item") {
      const card = (a.payload as Record<string, unknown>)?.card;
      if (typeof card === "string" && supporters.has(card)) {
        return { ...a, action_type: "play_supporter" };
      }
    }
    return a;
  });

  return NextResponse.json({
    match: {
      id: match.id,
      player_handle: match.player_handle,
      opponent_handle: match.opponent_handle,
      parser_version: match.parser_version,
    },
    turns: turns ?? [],
    actions: taggedActions,
  });
}
