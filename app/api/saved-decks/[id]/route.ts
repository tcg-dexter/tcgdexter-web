import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * DELETE /api/saved-decks/[id]
 * PATCH  /api/saved-decks/[id]
 *   body: { name?, notes?, is_public?, cover_image_url?, deck_list?, analysis? }
 *   When deck_list changes the caller also sends a freshly-computed analysis
 *   (from POST /api/analyze) so the stored snapshot stays in sync.
 *
 * Both require authentication. RLS on public.saved_decks ensures users
 * can only modify their own rows.
 */

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Sign in required." },
      { status: 401 }
    );
  }

  const { error } = await supabase.from("saved_decks").delete().eq("id", id);

  if (error) {
    console.error("[saved-decks] delete failed:", error);
    return NextResponse.json(
      { error: "Failed to delete deck." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Sign in required." },
      { status: 401 }
    );
  }

  let body: {
    name?: string;
    notes?: string;
    is_public?: boolean;
    cover_image_url?: string | null;
    deck_list?: string;
    analysis?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Build the update payload — only include provided fields
  const updates: Record<string, unknown> = {};

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) {
      return NextResponse.json(
        { error: "name cannot be empty" },
        { status: 400 }
      );
    }
    updates.name = name;
  }

  if (typeof body.notes === "string") {
    updates.notes = body.notes;
  }

  if (typeof body.is_public === "boolean") {
    updates.is_public = body.is_public;
  }

  // Cover image: null clears the override; otherwise must be a pokemontcg.io
  // image URL to prevent arbitrary <img src> injection on every page that
  // renders the deck preview card.
  if ("cover_image_url" in body) {
    const val = body.cover_image_url;
    if (val === null) {
      updates.cover_image_url = null;
    } else if (
      typeof val === "string" &&
      val.startsWith("https://images.pokemontcg.io/")
    ) {
      updates.cover_image_url = val;
    } else {
      return NextResponse.json(
        { error: "cover_image_url must be a pokemontcg.io URL or null" },
        { status: 400 }
      );
    }
  }

  // Deck list: replacing it also replaces the stored analysis snapshot, which
  // the client recomputes via POST /api/analyze and sends alongside.
  if (typeof body.deck_list === "string") {
    const dl = body.deck_list.trim();
    if (!dl) {
      return NextResponse.json(
        { error: "deck_list cannot be empty" },
        { status: 400 }
      );
    }
    updates.deck_list = dl;
    if ("analysis" in body) {
      updates.analysis = body.analysis ?? null;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "Nothing to update" },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("saved_decks")
    .update(updates)
    .eq("id", id);

  if (error) {
    console.error("[saved-decks] update failed:", error);
    return NextResponse.json(
      { error: "Failed to update deck." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, ...updates });
}
