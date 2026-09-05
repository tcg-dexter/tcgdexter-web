import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { idColumn } from "@/lib/shortId";
import { buildReplayPayload } from "@/lib/replay/frames";
import { buildBeats } from "@/lib/replay2/beats";

/** Resolve a TCG Live handle to the username of the PUBLIC profile that has
 *  claimed it, or null. Case-insensitive match on profiles.tcg_live_handle
 *  (which carries a lower(...) index). Used to link the mat name tags to the
 *  players' profiles when they're on the site and public. */
async function publicProfileUsernameForHandle(
  admin: ReturnType<typeof createAdminClient>,
  handle: string | null,
): Promise<string | null> {
  if (!handle) return null;
  // Escape LIKE metacharacters so a handle containing "_" or "%" matches
  // literally — ilike with no unescaped wildcards is a case-insensitive equals.
  const pattern = handle.replace(/([\\%_])/g, "\\$1");
  const { data } = await admin
    .from("profiles")
    .select("username, is_public")
    .ilike("tcg_live_handle", pattern)
    .maybeSingle();
  if (!data || !data.is_public || !data.username) return null;
  return data.username as string;
}

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

  // The signed-in viewer, if any — mirrors the owner bypass in the battle
  // page itself (app/battles/[id]/page.tsx): the owner can always load
  // their own replay, even when the deck or profile is still private.
  const supabase = await createClient();
  const {
    data: { user: viewer },
  } = await supabase.auth.getUser();

  const { data: battle } = await admin
    .from("matches")
    .select("id, battle_log_raw, player_handle, opponent_handle, source, saved_deck_id")
    .eq(idColumn(id), id)
    .maybeSingle();

  if (!battle) return NextResponse.json({ error: "Not found." }, { status: 404 });

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
  if (!battle.battle_log_raw) {
    return NextResponse.json({ error: "This battle has no battle log." }, { status: 400 });
  }

  const handle = (battle.player_handle as string | null) ?? "";
  const logRaw = battle.battle_log_raw as string;

  const [playerProfileUsername, opponentProfileUsername] = await Promise.all([
    publicProfileUsernameForHandle(admin, battle.player_handle as string | null),
    publicProfileUsernameForHandle(admin, battle.opponent_handle as string | null),
  ]);

  return NextResponse.json({
    ...buildReplayPayload(battle.id as string, logRaw, handle),
    beats: buildBeats(logRaw, handle),
    battleLogRaw: logRaw,
    playerProfileUsername,
    opponentProfileUsername,
  });
}
