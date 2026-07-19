import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { track } from "@/lib/analytics/track";
import { isTrustedCardImageUrl } from "@/lib/cardImages";
import { analyzeDeckList, detectDeckArchetype, DeckParseError } from "@/lib/analyzeDeck";

/**
 * DELETE /api/saved-decks/[id]
 * PATCH  /api/saved-decks/[id]
 *   body: { name?, notes?, is_public?, is_favorite?, is_pinned?,
 *           cover_image_url?, deck_list? }
 *   Setting is_pinned:true clears it on the caller's other decks first, so
 *   at most one deck is pinned per user.
 *   A deck_list change is re-analyzed server-side (any client-sent
 *   `analysis` is ignored) and, if the freshly detected archetype differs
 *   from the deck's stored identity, the response carries an
 *   `archetypeSuggestion` for the owner to act on.
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

  // Deck list: re-analyze server-side and, if the freshly detected
  // archetype differs from the deck's stored identity, surface it as a
  // suggestion — never auto-applied, the owner decides.
  let archetypeSuggestion:
    | {
        archetypeId: string | null;
        archetypeName: string;
        current: { archetypeId: string | null; archetypeName: string | null };
      }
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

    let analysisResult;
    try {
      analysisResult = analyzeDeckList(dl);
    } catch (err) {
      if (err instanceof DeckParseError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      console.error("[saved-decks] analyze failed:", err);
      return NextResponse.json(
        { error: "Failed to update deck." },
        { status: 500 }
      );
    }

    const detected = detectDeckArchetype(analysisResult);
    if (
      detected.archetypeName &&
      (detected.archetypeId ?? null) !== (deckRow.archetype_id ?? null) &&
      detected.archetypeName !== deckRow.archetype_name
    ) {
      archetypeSuggestion = {
        archetypeId: detected.archetypeId,
        archetypeName: detected.archetypeName,
        current: {
          archetypeId: deckRow.archetype_id ?? null,
          archetypeName: deckRow.archetype_name ?? null,
        },
      };
    }

    updates.deck_list = dl;
    updates.analysis = analysisResult;
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
    ...(archetypeSuggestion ? { archetypeSuggestion } : {}),
  });
}
