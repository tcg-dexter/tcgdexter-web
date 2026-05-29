import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/battles/[id]/log
 *
 * Public equivalent of /api/matches/[id]/battle-log. Uses the admin client
 * to bypass RLS, but enforces public-visibility rules in application code:
 * the match's saved deck must be public and the deck owner's profile must
 * be public. Returns the same response shape as the authenticated endpoint.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data: match } = await admin
    .from("matches")
    .select("id, player_handle, opponent_handle, parser_version, source, saved_deck_id")
    .eq("id", id)
    .maybeSingle();

  if (!match) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { data: deck } = await admin
    .from("saved_decks")
    .select("is_public, user_id")
    .eq("id", match.saved_deck_id as string)
    .maybeSingle();

  if (!deck?.is_public) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { data: profile } = await admin
    .from("profiles")
    .select("is_public")
    .eq("id", deck.user_id as string)
    .maybeSingle();

  if (!profile?.is_public) return NextResponse.json({ error: "Not found." }, { status: 404 });

  if ((match.source as string) !== "tcg_live_log") {
    return NextResponse.json({ error: "This match has no battle log." }, { status: 400 });
  }

  const [{ data: turns, error: turnsErr }, { data: actions, error: actionsErr }] =
    await Promise.all([
      admin
        .from("match_turns")
        .select("id, turn_number, player_turn_number, actor, actor_handle, phase")
        .eq("match_id", id)
        .order("turn_number", { ascending: true }),
      admin
        .from("match_actions")
        .select("id, turn_id, sequence, actor, action_type, payload, raw_text")
        .eq("match_id", id)
        .order("sequence", { ascending: true }),
    ]);

  if (turnsErr || actionsErr) {
    return NextResponse.json({ error: "Failed to load." }, { status: 500 });
  }

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
