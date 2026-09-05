import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { supporterNames } from "@/lib/supporterNames";
import { idColumn } from "@/lib/shortId";

/**
 * GET /api/battles/[id]/log
 *
 * Public equivalent of /api/matches/[id]/battle-log. Uses the admin client
 * to bypass RLS, but enforces public-visibility rules in application code:
 * the battle's saved deck must be public and the deck owner's profile must
 * be public. Returns the same response shape as the authenticated endpoint.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const admin = createAdminClient();

  // The signed-in viewer, if any — mirrors the owner bypass in the battle
  // page itself (app/battles/[id]/page.tsx): the owner can always load
  // their own battle log, even when the deck or profile is still private.
  const supabase = await createClient();
  const {
    data: { user: viewer },
  } = await supabase.auth.getUser();

  const { data: battle } = await admin
    .from("matches")
    .select("id, short_id, player_handle, opponent_handle, parser_version, source, saved_deck_id")
    .eq(idColumn(id), id)
    .maybeSingle();

  if (!battle) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // Turns/actions key off the real row id, not the URL param.
  const battleId = battle.id as string;

  const { data: deck } = await admin
    .from("saved_decks")
    .select("is_public, user_id")
    .eq("id", battle.saved_deck_id as string)
    .maybeSingle();

  if (!deck) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const isOwner = !!viewer && viewer.id === (deck.user_id as string);

  if (!isOwner && !deck.is_public) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("is_public")
    .eq("id", deck.user_id as string)
    .maybeSingle();

  if (!isOwner && !profile?.is_public) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  if ((battle.source as string) !== "tcg_live_log") {
    return NextResponse.json({ error: "This battle has no battle log." }, { status: 400 });
  }

  const [{ data: turns, error: turnsErr }, { data: actions, error: actionsErr }] =
    await Promise.all([
      admin
        .from("match_turns")
        .select("id, turn_number, player_turn_number, actor, actor_handle, phase")
        .eq("match_id", battleId)
        .order("turn_number", { ascending: true }),
      admin
        .from("match_actions")
        .select("id, turn_id, sequence, actor, action_type, payload, raw_text")
        .eq("match_id", battleId)
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
    battle: {
      id: battle.id,
      player_handle: battle.player_handle,
      opponent_handle: battle.opponent_handle,
      parser_version: battle.parser_version,
    },
    turns: turns ?? [],
    actions: taggedActions,
  });
}
