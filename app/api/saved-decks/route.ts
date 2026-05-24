import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/saved-decks
 *
 * Saves a deck list + analysis snapshot to the authenticated user's
 * personal "My Decks" library. Sign-in required.
 *
 * Body: { deckList: string, analysis?: object, name?: string }
 */
export async function POST(req: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Sign in required to save decks." },
      { status: 401 }
    );
  }

  let body: {
    deckList?: string;
    analysis?: unknown;
    name?: string;
    /**
     * When true, save the deck with is_public=true and return the canonical
     * /u/[username]/[id] path so the client can route the user to their
     * post. Requires the caller's profile to have a username and is_public
     * set; otherwise we 422 with a hint.
     */
    publish?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { deckList, analysis, name, publish } = body;

  if (!deckList || typeof deckList !== "string" || !deckList.trim()) {
    return NextResponse.json(
      { error: "deckList is required" },
      { status: 400 }
    );
  }

  // Derive name if not provided
  const analysisObj =
    analysis && typeof analysis === "object"
      ? (analysis as { metaMatch?: { archetypeName?: string | null } })
      : null;
  const archetype = analysisObj?.metaMatch?.archetypeName ?? null;
  const finalName =
    (typeof name === "string" && name.trim()) || archetype || "Untitled Deck";

  // Publish path: validate that the caller can actually be a public author
  // before we flip is_public on the new row. The cascading RLS rule from
  // phase 1 (deck.is_public AND owner.is_public) means a public-deck row
  // is invisible if the owner profile is private — and a username is
  // required for the trainer URL to resolve.
  let ownerUsername: string | null = null;
  if (publish) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("username, is_public")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.username) {
      return NextResponse.json(
        { error: "Set a username on your profile before sharing." },
        { status: 422 },
      );
    }
    if (!profile.is_public) {
      return NextResponse.json(
        { error: "Make your profile public before sharing decks." },
        { status: 422 },
      );
    }
    ownerUsername = profile.username;
  }

  const { data, error } = await supabase
    .from("saved_decks")
    .insert({
      user_id: user.id,
      name: finalName,
      deck_list: deckList,
      analysis: analysis ?? null,
      is_public: publish === true,
    })
    .select("id, name, created_at")
    .single();

  if (error) {
    console.error("[saved-decks] insert failed:", error);
    return NextResponse.json(
      { error: "Failed to save deck." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    id: data.id,
    name: data.name,
    createdAt: data.created_at,
    ...(ownerUsername
      ? { publicUrl: `/u/${ownerUsername}/${data.id}` }
      : {}),
  });
}
