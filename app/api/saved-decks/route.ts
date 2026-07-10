import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { track } from "@/lib/analytics/track";
import { isTrustedCardImageUrl } from "@/lib/cardImages";
import {
  analyzeDeckList,
  detectDeckArchetype,
  DeckParseError,
  type AnalysisResult,
} from "@/lib/analyzeDeck";
import { primaryPokemonCard } from "@/lib/primaryCardImage";

/**
 * POST /api/saved-decks
 *
 * Saves a deck to the authenticated user's library. The analysis snapshot
 * is computed server-side (any client-sent `analysis` is ignored), the
 * deck's archetype identity is auto-detected, and the deck's v1 version
 * row is created alongside. Sign-in required.
 *
 * Body: { deckList: string, name?: string, coverUrl?, publish?, source?, metaArchetypeId? }
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
    coverUrl?: string | null;
    /**
     * When true, save the deck with is_public=true and return the canonical
     * /u/[username]/[id] path so the client can route the user to their
     * post. Requires the caller's profile to have a username and is_public
     * set; otherwise we 422 with a hint.
     */
    publish?: boolean;
    /**
     * Origin of the save — informational. When "meta", we fire a parallel
     * `meta.deck.saved` event so the Meta Archetypes Product can count it
     * without losing the umbrella `deck.saved` count.
     */
    source?: "meta";
    metaArchetypeId?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { deckList, analysis, name, coverUrl, publish, source, metaArchetypeId } = body;

  if (!deckList || typeof deckList !== "string" || !deckList.trim()) {
    return NextResponse.json(
      { error: "deckList is required" },
      { status: 400 }
    );
  }

  // Cover image (optional) must be one of our trusted card-image hosts — same
  // allowlist as the PATCH route — to prevent arbitrary <img src> injection.
  if (coverUrl != null && !(typeof coverUrl === "string" && isTrustedCardImageUrl(coverUrl))) {
    return NextResponse.json(
      { error: "coverUrl must be a trusted card-image URL or null" },
      { status: 400 }
    );
  }

  // Server-side analysis — the client-sent snapshot is never persisted.
  // (`analysis` stays in the body type for older deployed clients.)
  void analysis;
  let analysisResult: AnalysisResult;
  try {
    analysisResult = analyzeDeckList(deckList);
  } catch (err) {
    if (err instanceof DeckParseError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[saved-decks] analyze failed:", err);
    return NextResponse.json(
      { error: "Failed to save deck." },
      { status: 500 }
    );
  }

  // Deck-level archetype identity (repo = archetype), auto-detected.
  const detected = detectDeckArchetype(analysisResult);
  const archetype = detected.archetypeName;
  const primaryPokemon =
    primaryPokemonCard(analysisResult.cards)?.card.name ?? null;

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
      analysis: analysisResult,
      is_public: publish === true,
      archetype_id: detected.archetypeId,
      archetype_name: detected.archetypeName,
      archetype_source: "auto",
      primary_pokemon_name: primaryPokemon,
      ...(coverUrl != null ? { cover_image_url: coverUrl } : {}),
    })
    .select("id, short_id, name, created_at")
    .single();

  if (error) {
    console.error("[saved-decks] insert failed:", error);
    return NextResponse.json(
      { error: "Failed to save deck." },
      { status: 500 }
    );
  }

  // v1 — the deck's first version. Direct insert: the row above already
  // carries the mirror, and a brand-new deck can't race on numbering.
  const { error: verErr } = await supabase.from("deck_versions").insert({
    deck_id: data.id,
    version_number: 1,
    deck_list: deckList,
    analysis: analysisResult,
  });
  if (verErr) {
    // Deck stays usable — the next commit becomes its v1.
    console.error("[saved-decks] v1 insert failed:", verErr);
  }

  void track(req, "deck.saved", {
    archetype,
    is_public: publish === true,
    name: finalName,
    source: source ?? null,
  });

  if (source === "meta") {
    void track(req, "meta.deck.saved", {
      archetype,
      meta_archetype_id: metaArchetypeId ?? null,
      is_public: publish === true,
    });
  }

  return NextResponse.json({
    id: data.id,
    shortId: data.short_id,
    name: data.name,
    createdAt: data.created_at,
    ...(ownerUsername
      ? { publicUrl: `/u/${ownerUsername}/${data.short_id}` }
      : {}),
  });
}
