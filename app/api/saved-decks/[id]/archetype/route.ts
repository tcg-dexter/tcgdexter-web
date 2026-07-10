import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { track } from "@/lib/analytics/track";
import {
  detectDeckArchetype,
  type AnalysisResult,
} from "@/lib/analyzeDeck";
import { primaryPokemonCard } from "@/lib/primaryCardImage";

/**
 * POST /api/saved-decks/[id]/archetype
 *   body: { mode: "auto" }
 *     Recompute the deck's archetype identity from its latest analysis
 *     snapshot (accepting a drift suggestion does this).
 *   body: { mode: "manual", archetype_id: string | null, archetype_name: string }
 *     Owner override. Dismissing a drift suggestion = manual-set to the
 *     current values, making "keep as is" an explicit choice.
 *
 * Owner only (RLS enforces the write; we also check to return a clean 404).
 */

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  let body: {
    mode?: string;
    archetype_id?: string | null;
    archetype_name?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { data: deck } = await supabase
    .from("saved_decks")
    .select("id, user_id, analysis")
    .eq("id", id)
    .maybeSingle();

  if (!deck || deck.user_id !== user.id) {
    return NextResponse.json({ error: "Deck not found." }, { status: 404 });
  }

  let updates: {
    archetype_id: string | null;
    archetype_name: string | null;
    archetype_source: "auto" | "manual";
    primary_pokemon_name?: string | null;
  };

  if (body.mode === "auto") {
    const analysis = deck.analysis as AnalysisResult | null;
    if (!analysis) {
      return NextResponse.json(
        { error: "Deck has no analysis to detect from." },
        { status: 422 },
      );
    }
    const detected = detectDeckArchetype(analysis);
    updates = {
      archetype_id: detected.archetypeId,
      archetype_name: detected.archetypeName,
      archetype_source: "auto",
      primary_pokemon_name: analysis.cards
        ? primaryPokemonCard(analysis.cards)?.card.name ?? null
        : null,
    };
  } else if (body.mode === "manual") {
    const name =
      typeof body.archetype_name === "string" ? body.archetype_name.trim() : "";
    if (!name) {
      return NextResponse.json(
        { error: "archetype_name is required for manual mode" },
        { status: 400 },
      );
    }
    updates = {
      archetype_id:
        typeof body.archetype_id === "string" && body.archetype_id
          ? body.archetype_id
          : null,
      archetype_name: name,
      archetype_source: "manual",
    };
  } else {
    return NextResponse.json(
      { error: "mode must be 'auto' or 'manual'" },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("saved_decks")
    .update(updates)
    .eq("id", id);

  if (error) {
    console.error("[archetype] update failed:", error);
    return NextResponse.json(
      { error: "Failed to update archetype." },
      { status: 500 },
    );
  }

  void track(req, "deck.archetype_set", {
    id,
    mode: body.mode,
    archetype: updates.archetype_name,
  });

  return NextResponse.json({
    success: true,
    archetype_id: updates.archetype_id,
    archetype_name: updates.archetype_name,
    archetype_source: updates.archetype_source,
  });
}
