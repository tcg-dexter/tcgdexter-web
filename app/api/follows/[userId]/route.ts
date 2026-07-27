import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { notifyNewFollower } from "@/lib/notifications/notify";

/** One entry in a followers/following list. */
export interface FollowListUser {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

/**
 * GET /api/follows/[userId]?type=followers|following
 *   — list the users who follow this profile (followers) or whom this
 *     profile follows (following), newest-follow first.
 *
 * Auth-gated: user_follows is readable only `to authenticated` (see the
 * migration's RLS), so an anon caller gets 401 — the client turns that into
 * a "sign in to see this list" prompt. Only PUBLIC profiles surface, since
 * profiles_public_read exposes only is_public rows; private followers are
 * omitted (the count on the button remains the true total).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const type = new URL(req.url).searchParams.get("type");
  if (type !== "followers" && type !== "following") {
    return NextResponse.json(
      { error: "type must be 'followers' or 'following'." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to see this list." },
      { status: 401 },
    );
  }

  // followers → rows pointing AT userId; collect the followers.
  // following → rows FROM userId; collect who they follow.
  let ids: string[] = [];
  if (type === "followers") {
    const { data, error } = await supabase
      .from("user_follows")
      .select("follower_user_id, created_at")
      .eq("following_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    ids = (data ?? []).map((r) => r.follower_user_id as string);
  } else {
    const { data, error } = await supabase
      .from("user_follows")
      .select("following_user_id, created_at")
      .eq("follower_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    ids = (data ?? []).map((r) => r.following_user_id as string);
  }

  if (ids.length === 0) {
    return NextResponse.json({ users: [] as FollowListUser[] });
  }

  // Resolve display fields. profiles_public_read gates this to public
  // profiles only, so private users drop out here (intentionally).
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url")
    .in("id", ids);
  if (profilesError) {
    return NextResponse.json({ error: profilesError.message }, { status: 400 });
  }

  // Preserve the newest-follow-first order from user_follows (the .in()
  // above doesn't guarantee ordering).
  const byId = new Map(
    (profiles ?? []).map((p) => [p.id, p as FollowListUser]),
  );
  const users = ids
    .map((id) => byId.get(id))
    .filter((u): u is FollowListUser => !!u);

  return NextResponse.json({ users });
}

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
