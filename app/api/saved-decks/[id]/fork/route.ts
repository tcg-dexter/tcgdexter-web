import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { track } from "@/lib/analytics/track";
import { primaryPokemonCard } from "@/lib/primaryCardImage";
import type { AnalysisResult } from "@/lib/analyzeDeck";

/**
 * GET  /api/saved-decks/[id]/fork
 *   Fork metadata for a deck page: total fork count (includes private
 *   forks — computed by the SECURITY DEFINER deck_fork_count function) and
 *   the viewer's own existing fork, if any.
 *
 * POST /api/saved-decks/[id]/fork
 *   GitHub-style fork: a new private deck in the caller's library carrying
 *   permanent "forked from deck X" lineage. RLS gates what can be read as
 *   a source (own decks, or public deck + public owner), so self-forks are
 *   legal. Forking twice creates a second fork — the idempotent
 *   save-toggle flavor lives at /clone.
 *
 *   cloned_from_id is dual-written during the clone→fork transition; a
 *   cleanup migration drops it once deployed clients stop reading it.
 */

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: count, error } = await supabase.rpc("deck_fork_count", {
    p_deck_id: id,
  });

  if (error) {
    console.error("[fork] count failed:", error);
    return NextResponse.json(
      { error: "Failed to load fork info." },
      { status: 500 },
    );
  }

  let viewerForkId: string | null = null;
  if (user) {
    const { data: existing } = await supabase
      .from("saved_decks")
      .select("id")
      .eq("forked_from_deck_id", id)
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    viewerForkId = existing?.id ?? null;
  }

  return NextResponse.json({ count: Number(count ?? 0), viewerForkId });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sourceDeckId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  // Source deck row — RLS lets this through for own decks and public ones.
  const { data: source } = await supabase
    .from("saved_decks")
    .select("id, name, deck_list, analysis, archetype_id, archetype_name, cover_image_url")
    .eq("id", sourceDeckId)
    .maybeSingle();

  if (!source) {
    return NextResponse.json(
      { error: "Deck not available to fork." },
      { status: 404 },
    );
  }

  const analysis = (source.analysis as AnalysisResult | null) ?? null;
  const primaryPokemon = analysis?.cards
    ? primaryPokemonCard(analysis.cards)?.card.name ?? null
    : null;

  const { data: fork, error: insErr } = await supabase
    .from("saved_decks")
    .insert({
      user_id: user.id,
      name: source.name,
      deck_list: source.deck_list,
      analysis: source.analysis,
      is_public: false,
      forked_from_deck_id: sourceDeckId,
      cloned_from_id: sourceDeckId,
      archetype_id: source.archetype_id ?? null,
      archetype_name: source.archetype_name ?? null,
      archetype_source: "auto",
      primary_pokemon_name: primaryPokemon,
      cover_image_url: source.cover_image_url ?? null,
    })
    .select("id, short_id, name")
    .single();

  if (insErr || !fork) {
    console.error("[fork] insert failed:", insErr);
    return NextResponse.json({ error: "Failed to fork deck." }, { status: 500 });
  }

  void track(req, "deck.forked", {
    source_deck_id: sourceDeckId,
    fork_id: fork.id,
  });

  return NextResponse.json({
    deckId: fork.id,
    shortId: fork.short_id,
    name: fork.name,
  });
}
