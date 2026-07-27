import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { notifyDeckLiked } from "@/lib/notifications/notify";

/**
 * POST   /api/saved-decks/[id]/like   — like a public deck (idempotent)
 * DELETE /api/saved-decks/[id]/like   — remove your like (idempotent)
 *
 * RLS enforces:
 *   - the caller is authenticated
 *   - the target deck is public AND its owner profile is public
 *   - the inserted user_id matches auth.uid()
 *
 * The `like_count` denormalized column on saved_decks is kept in sync
 * by the deck_likes_count_sync trigger; we just return the updated
 * count after the write so the client can settle its optimistic state.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: deckId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { error: insertError } = await supabase
    .from("deck_likes")
    .insert({ user_id: user.id, saved_deck_id: deckId })
    // Idempotent: liking an already-liked deck is a no-op, not an error.
    .select()
    .maybeSingle();

  // Surface RLS / FK / unique-violation errors. 23505 = unique violation
  // (already liked) — treat as success.
  if (insertError && insertError.code !== "23505") {
    return NextResponse.json(
      { error: insertError.message },
      { status: insertError.code === "42501" ? 403 : 400 },
    );
  }

  // Notify the deck owner — only on a GENUINE new like (a true insert, no
  // error). A 23505 no-op re-like must not re-notify; the notify helper also
  // suppresses self-likes. Fire-and-forget like the analytics tracker.
  if (!insertError) {
    void notifyDeckLiked({ deckId, actorId: user.id });
  }

  const count = await readLikeCount(supabase, deckId);
  return NextResponse.json({ liked: true, like_count: count });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: deckId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { error } = await supabase
    .from("deck_likes")
    .delete()
    .eq("user_id", user.id)
    .eq("saved_deck_id", deckId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const count = await readLikeCount(supabase, deckId);
  return NextResponse.json({ liked: false, like_count: count });
}

async function readLikeCount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  deckId: string,
): Promise<number> {
  const { data } = await supabase
    .from("saved_decks")
    .select("like_count")
    .eq("id", deckId)
    .maybeSingle();
  return data?.like_count ?? 0;
}
