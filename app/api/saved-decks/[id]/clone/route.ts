import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { primaryPokemonCard } from "@/lib/primaryCardImage";
import type { AnalysisResult } from "@/lib/analyzeDeck";

/**
 * The save/unsave TOGGLE flavor of copying a deck into your own library.
 * Records clone lineage (cloned_from_id) so the "already saved" lookup
 * below works.
 *
 * GET    /api/saved-decks/[id]/clone — has the caller already saved this?
 * POST   /api/saved-decks/[id]/clone — copy into the caller's library
 *                                      (idempotent — returns the existing
 *                                      copy if there is one).
 * DELETE /api/saved-decks/[id]/clone — drop the caller's copy/copies of it.
 *
 * RLS on saved_decks already gates public read (deck + owner both public)
 * and restricts owner-only writes, so we just operate through the user's
 * supabase client and let the policies enforce visibility.
 */

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sourceId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ saved: false, savedId: null });
  }

  const { data } = await supabase
    .from("saved_decks")
    .select("id")
    .eq("cloned_from_id", sourceId)
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    saved: !!data,
    savedId: data?.id ?? null,
  });
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sourceId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Sign in required." },
      { status: 401 },
    );
  }

  // Don't create duplicate copies — return the existing one if present.
  const { data: existing } = await supabase
    .from("saved_decks")
    .select("id")
    .eq("cloned_from_id", sourceId)
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ saved: true, savedId: existing.id });
  }

  // Read the source row — RLS lets this through only when the deck and
  // its owner are both public (or it's the caller's own deck).
  const { data: source, error: srcErr } = await supabase
    .from("saved_decks")
    .select("name, deck_list, analysis, archetype_id, archetype_name, cover_image_url")
    .eq("id", sourceId)
    .maybeSingle();

  if (srcErr || !source) {
    return NextResponse.json(
      { error: "Deck not available to save." },
      { status: 404 },
    );
  }

  const analysis = (source.analysis as AnalysisResult | null) ?? null;
  const primaryPokemon = analysis?.cards
    ? primaryPokemonCard(analysis.cards)?.card.name ?? null
    : null;

  const { data: cloned, error: insErr } = await supabase
    .from("saved_decks")
    .insert({
      user_id: user.id,
      name: source.name,
      deck_list: source.deck_list,
      analysis: source.analysis,
      is_public: false,
      cloned_from_id: sourceId,
      archetype_id: source.archetype_id ?? null,
      archetype_name: source.archetype_name ?? null,
      archetype_source: "auto",
      primary_pokemon_name: primaryPokemon,
      cover_image_url: source.cover_image_url ?? null,
    })
    .select("id")
    .single();

  if (insErr || !cloned) {
    console.error("[saved-decks/clone] insert failed:", insErr);
    return NextResponse.json(
      { error: "Failed to save deck." },
      { status: 500 },
    );
  }

  return NextResponse.json({ saved: true, savedId: cloned.id });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sourceId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Sign in required." },
      { status: 401 },
    );
  }

  const { error } = await supabase
    .from("saved_decks")
    .delete()
    .eq("cloned_from_id", sourceId)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ saved: false, savedId: null });
}
