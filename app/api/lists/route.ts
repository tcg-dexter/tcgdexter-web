import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { track } from "@/lib/analytics/track";
import { hydrateListPreviews, type ListRow } from "@/lib/lists";

/**
 * GET /api/lists?setId=&number=
 *
 * The authenticated caller's own lists, newest first. When setId+number are
 * both present, each returned list also carries `containsCard` so the
 * Add-to-list picker can pre-check the ones the card is already in.
 *
 * POST /api/lists
 *   body: { name: string, isPublic: boolean, cardToAdd?: { setId, number } }
 *
 * Creating ANY list (even a private one) requires a username — every list's
 * URL is /u/[username]/lists/[shortId], so there's no other way to address
 * it. This is stricter than saved_decks, which only requires a username to
 * *publish*; lists have exactly one route shape, so the gate applies
 * unconditionally. Publishing (isPublic: true) additionally requires the
 * profile itself to be public, mirroring saved_decks' publish gate.
 */

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const url = new URL(req.url);
  const setId = url.searchParams.get("setId");
  const number = url.searchParams.get("number");

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();
  const username = (profile?.username as string | null) ?? null;

  const { data: rows, error } = await supabase
    .from("lists")
    .select("id, short_id, name, is_public")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[lists] list failed:", error);
    return NextResponse.json({ error: "Failed to load lists." }, { status: 500 });
  }

  const lists = await hydrateListPreviews(
    supabase,
    username,
    (rows ?? []) as ListRow[],
    setId && number ? { checkCard: { setId, number } } : undefined,
  );

  return NextResponse.json({ lists, hasUsername: !!username });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  let body: {
    name?: string;
    isPublic?: boolean;
    cardToAdd?: { setId: string; number: string };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required." }, { status: 400 });
  }
  const isPublic = body.isPublic === true;

  // Every list needs a username unconditionally (see header note) — a
  // stricter gate than saved_decks' publish-only check.
  const { data: profile } = await supabase
    .from("profiles")
    .select("username, is_public")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.username) {
    return NextResponse.json(
      { error: "Set a username on your profile before creating lists." },
      { status: 422 },
    );
  }
  if (isPublic && !profile.is_public) {
    return NextResponse.json(
      { error: "Make your profile public before sharing lists." },
      { status: 422 },
    );
  }

  const { data, error } = await supabase
    .from("lists")
    .insert({ user_id: user.id, name, is_public: isPublic })
    .select("id, short_id, name, is_public")
    .single();

  if (error) {
    console.error("[lists] insert failed:", error);
    return NextResponse.json({ error: "Failed to create list." }, { status: 500 });
  }

  if (body.cardToAdd) {
    const { setId, number } = body.cardToAdd;
    if (typeof setId === "string" && setId && typeof number === "string" && number) {
      const { error: itemError } = await supabase
        .from("list_items")
        .insert({ list_id: data.id, set_id: setId, number });
      // Best-effort: a failed item-add doesn't roll back the list itself.
      if (itemError) {
        console.error("[lists] initial card-add failed:", itemError);
      }
    }
  }

  void track(req, "list.created", {
    is_public: isPublic,
    had_card: !!body.cardToAdd,
  });

  return NextResponse.json({
    id: data.id,
    shortId: data.short_id,
    name: data.name,
    isPublic: data.is_public,
    href: `/u/${profile.username}/lists/${data.short_id}`,
  });
}
