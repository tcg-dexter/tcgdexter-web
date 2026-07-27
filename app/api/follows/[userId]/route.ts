import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { notifyNewFollower } from "@/lib/notifications/notify";

/**
 * POST   /api/follows/[userId]   — follow a public profile (idempotent)
 * DELETE /api/follows/[userId]   — unfollow (idempotent)
 *
 * RLS enforces:
 *   - the caller is authenticated
 *   - the target profile is PUBLIC (you can't follow what you can't see)
 *   - the inserted follower_user_id matches auth.uid()
 *
 * profiles.follower_count / following_count are kept in sync by the
 * user_follows_count_sync trigger; we return the target's follower_count
 * after the write so the client can settle its optimistic state.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId: targetUserId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (user.id === targetUserId) {
    return NextResponse.json(
      { error: "You can't follow yourself." },
      { status: 400 },
    );
  }

  const { error: insertError } = await supabase
    .from("user_follows")
    .insert({ follower_user_id: user.id, following_user_id: targetUserId })
    // Idempotent: following an already-followed user is a no-op, not an error.
    .select()
    .maybeSingle();

  // 23505 = unique violation (already following) — treat as success. Other
  // codes surface: 42501 = RLS denial (target not public / not you) → 403.
  if (insertError && insertError.code !== "23505") {
    return NextResponse.json(
      { error: insertError.message },
      { status: insertError.code === "42501" ? 403 : 400 },
    );
  }

  // Notify the followed user — only on a GENUINE new follow (a true insert,
  // no error). A 23505 no-op re-follow-while-following must not re-notify;
  // the notify helper also suppresses self-follows. Fire-and-forget.
  if (!insertError) {
    void notifyNewFollower({ recipientId: targetUserId, actorId: user.id });
  }

  const count = await readFollowerCount(supabase, targetUserId);
  return NextResponse.json({ following: true, follower_count: count });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId: targetUserId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { error } = await supabase
    .from("user_follows")
    .delete()
    .eq("follower_user_id", user.id)
    .eq("following_user_id", targetUserId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const count = await readFollowerCount(supabase, targetUserId);
  return NextResponse.json({ following: false, follower_count: count });
}

async function readFollowerCount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<number> {
  const { data } = await supabase
    .from("profiles")
    .select("follower_count")
    .eq("id", userId)
    .maybeSingle();
  return data?.follower_count ?? 0;
}
