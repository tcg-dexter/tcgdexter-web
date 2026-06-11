import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/admin/spotlight
 * Body: { username: string }
 * Creates a draft trainer_spotlight for the given username (slug defaults
 * to the username). Admin-only.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Auth required" }, { status: 401 });
  }

  const { data: me } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle<{ is_admin: boolean }>();
  if (!me?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { username?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const username = body.username?.trim().toLowerCase();
  if (!username) {
    return NextResponse.json({ error: "username required" }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username")
    .eq("username", username)
    .maybeSingle<{ id: string; username: string }>();
  if (!profile) {
    return NextResponse.json(
      { error: `No profile with username "${username}"` },
      { status: 404 }
    );
  }

  const { data: existing } = await supabase
    .from("trainer_spotlights")
    .select("id")
    .eq("profile_id", profile.id)
    .maybeSingle<{ id: string }>();
  if (existing) {
    return NextResponse.json({ id: existing.id });
  }

  const { data: inserted, error } = await supabase
    .from("trainer_spotlights")
    .insert({
      profile_id: profile.id,
      slug: profile.username,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: inserted.id });
}
