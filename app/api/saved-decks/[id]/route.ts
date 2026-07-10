import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { track } from "@/lib/analytics/track";
import { isTrustedCardImageUrl } from "@/lib/cardImages";
import { DeckParseError } from "@/lib/analyzeDeck";
import { commitDeckVersion } from "@/lib/deck-versions";

/**
 * DELETE /api/saved-decks/[id]
 * PATCH  /api/saved-decks/[id]
 *   body: { name?, notes?, is_public?, is_favorite?, is_pinned?,
 *           cover_image_url?, deck_list?, version_name?, changelog? }
 *   Setting is_pinned:true clears it on the caller's other decks first, so
 *   at most one deck is pinned per user.
 *   A deck_list change is a version commit: the analysis snapshot is
 *   recomputed server-side (any client-sent `analysis` is ignored) and a
 *   new deck_versions row is created via create_deck_version() — unless the
 *   list parses identical to the latest version, which is a no-op.
 *
 * Both require authentication. RLS on public.saved_decks ensures users
 * can only modify their own rows.
 */

export async function DELETE(
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

  const { error } = await supabase.from("saved_decks").delete().eq("id", id);

  if (error) {
    console.error("[saved-decks] delete failed:", error);
    return NextResponse.json(
      { error: "Failed to delete deck." },
      { status: 500 }
    );
  }

  void track(req, "deck.deleted", { id });

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
    is_favorite?: boolean;
    is_pinned?: boolean;
    cover_image_url?: string | null;
    deck_list?: string;
    /** Ignored — the snapshot is recomputed server-side on deck_list change. */
    analysis?: unknown;
    version_name?: string;
    changelog?: string;
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

  if (typeof body.is_favorite === "boolean") {
    updates.is_favorite = body.is_favorite;
  }

  if (typeof body.is_pinned === "boolean") {
    if (body.is_pinned) {
      // Exclusive: only one deck may be pinned per user, so clear it on
      // every other deck before setting it here.
      const { error: unpinError } = await supabase
        .from("saved_decks")
        .update({ is_pinned: false })
        .eq("user_id", user.id)
        .neq("id", id);
      if (unpinError) {
        console.error("[saved-decks] unpin-others failed:", unpinError);
        return NextResponse.json(
          { error: "Failed to update pinned deck." },
          { status: 500 }
        );
      }
    }
    updates.is_pinned = body.is_pinned;
  }

  // Cover image: null clears the override; otherwise must be one of our
  // trusted card-image hosts to prevent arbitrary <img src> injection on every
  // page that renders the deck preview card. The allowlist covers every set we
  // serve (pokemontcg.io alone wrongly rejected ME-era cards like the Chaos
  // Rising Mega Greninja ex, whose images come from scrydex).
  if ("cover_image_url" in body) {
    const val = body.cover_image_url;
    if (val === null) {
      updates.cover_image_url = null;
    } else if (typeof val === "string" && isTrustedCardImageUrl(val)) {
      updates.cover_image_url = val;
    } else {
      return NextResponse.json(
        { error: "cover_image_url must be a trusted card-image URL or null" },
        { status: 400 }
      );
    }
  }

  // Deck list: a content change is a version commit. commitDeckVersion
  // re-analyzes server-side, skips no-op saves, and the RPC updates the
  // deck_list/analysis mirror on saved_decks atomically with the version
  // row — so deck_list never goes through the plain update below.
  let committedVersion: {
    id: string;
    version_number: number;
    name: string | null;
    created: boolean;
  } | null = null;
  let archetypeSuggestion:
    | { archetypeId: string | null; archetypeName: string }
    | undefined;

  if (typeof body.deck_list === "string") {
    const dl = body.deck_list.trim();
    if (!dl) {
      return NextResponse.json(
        { error: "deck_list cannot be empty" },
        { status: 400 }
      );
    }

    const { data: deckRow } = await supabase
      .from("saved_decks")
      .select("id, user_id, archetype_id, archetype_name")
      .eq("id", id)
      .maybeSingle();
    if (!deckRow || deckRow.user_id !== user.id) {
      return NextResponse.json({ error: "Deck not found." }, { status: 404 });
    }

    try {
      const commit = await commitDeckVersion(supabase, {
        deckId: id,
        deckList: dl,
        name: typeof body.version_name === "string" ? body.version_name : null,
        changelog: typeof body.changelog === "string" ? body.changelog : "",
        currentArchetype: {
          id: deckRow.archetype_id ?? null,
          name: deckRow.archetype_name ?? null,
        },
      });
      committedVersion = {
        id: commit.version.id,
        version_number: commit.version.version_number,
        name: commit.version.name,
        created: commit.created,
      };
      archetypeSuggestion = commit.archetypeSuggestion;
    } catch (err) {
      if (err instanceof DeckParseError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      console.error("[saved-decks] version commit failed:", err);
      return NextResponse.json(
        { error: "Failed to update deck." },
        { status: 500 }
      );
    }
    // Track the content edit under the pre-existing event name.
    updates.deck_list = dl;
  }

  const metadataUpdates = { ...updates };
  delete metadataUpdates.deck_list;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "Nothing to update" },
      { status: 400 }
    );
  }

  if (Object.keys(metadataUpdates).length > 0) {
    const { error } = await supabase
      .from("saved_decks")
      .update(metadataUpdates)
      .eq("id", id);

    if (error) {
      console.error("[saved-decks] update failed:", error);
      return NextResponse.json(
        { error: "Failed to update deck." },
        { status: 500 }
      );
    }
  }

  // Pick the most meaningful event name for the update. Renames are common
  // and worth distinguishing from notes edits; deck_list replacement is the
  // strongest signal of active iteration on a deck.
  const updatedFields = Object.keys(updates);
  const eventName =
    "deck_list" in updates
      ? "deck.edited"
      : "name" in updates
      ? "deck.renamed"
      : "is_public" in updates
      ? updates.is_public === true
        ? "deck.published"
        : "deck.unpublished"
      : "is_favorite" in updates
      ? updates.is_favorite === true
        ? "deck.favorited"
        : "deck.unfavorited"
      : "is_pinned" in updates
      ? updates.is_pinned === true
        ? "deck.pinned"
        : "deck.unpinned"
      : "deck.updated";
  void track(req, eventName, { id, fields: updatedFields });

  return NextResponse.json({
    success: true,
    ...updates,
    ...(committedVersion ? { version: committedVersion } : {}),
    ...(archetypeSuggestion ? { archetypeSuggestion } : {}),
  });
}
