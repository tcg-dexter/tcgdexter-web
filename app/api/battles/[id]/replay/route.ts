import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { idColumn } from "@/lib/shortId";
import { buildReplayPayload } from "@/lib/replay/frames";

/**
 * GET /api/battles/[id]/replay
 *
 * Board-frame stream for the public battle page's playback viewer — the
 * frame-level counterpart to the thread that /api/battles/[id]/log feeds.
 * Uses the admin client to bypass RLS but enforces the same visibility
 * rules that sibling endpoint does, in application code: the battle's saved
 * deck must be public and the deck owner's profile must be public.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data: battle } = await admin
    .from("matches")
    .select("id, battle_log_raw, player_handle, source, saved_deck_id")
    .eq(idColumn(id), id)
    .maybeSingle();

  if (!battle) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { data: deck } = await admin
    .from("saved_decks")
    .select("is_public, user_id")
    .eq("id", battle.saved_deck_id as string)
    .maybeSingle();

  if (!deck?.is_public) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { data: profile } = await admin
    .from("profiles")
    .select("is_public")
    .eq("id", deck.user_id as string)
    .maybeSingle();

  if (!profile?.is_public) return NextResponse.json({ error: "Not found." }, { status: 404 });

  if ((battle.source as string) !== "tcg_live_log") {
    return NextResponse.json({ error: "This battle has no battle log." }, { status: 400 });
  }
  if (!battle.battle_log_raw) {
    return NextResponse.json({ error: "This battle has no battle log." }, { status: 400 });
  }

  return NextResponse.json(
    buildReplayPayload(
      battle.id as string,
      battle.battle_log_raw as string,
      (battle.player_handle as string | null) ?? "",
    ),
  );
}
