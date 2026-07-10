import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  normalizeGameResults,
  isValidGameResults,
  deriveResultFromGames,
  sanitizePrize,
  sanitizeGamePrizes,
} from "@/lib/bo3";

/**
 * PATCH /api/matches/[id]
 *
 * Edits a match record. RLS enforces owner-only access.
 * Accepts any combination of: result, opponent_name, opponent_archetype,
 * opponent_deck_list, notes, played_at, game_results.
 */
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
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  let body: {
    result?: string;
    opponent_name?: string | null;
    opponent_archetype?: string | null;
    opponent_deck_list?: string | null;
    notes?: string | null;
    played_at?: string | null;
    game_results?: string | null;
    prizes_taken_player?: number | null;
    prizes_taken_opponent?: number | null;
    game_prizes?: unknown;
    saved_deck_version_id?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if (body.result !== undefined) {
    if (!["win", "loss", "draw"].includes(body.result ?? "")) {
      return NextResponse.json(
        { error: "result must be win, loss, or draw." },
        { status: 400 }
      );
    }
    updates.result = body.result;
  }
  if (body.opponent_name !== undefined) updates.opponent_name = body.opponent_name?.trim() || null;
  if (body.opponent_archetype !== undefined) updates.opponent_archetype = body.opponent_archetype?.trim() || null;
  if (body.opponent_deck_list !== undefined) updates.opponent_deck_list = body.opponent_deck_list?.trim() || null;
  if (body.notes !== undefined) updates.notes = body.notes?.trim() || null;
  if (body.played_at !== undefined) updates.played_at = body.played_at || null;

  // Best-of-3: a non-null sequence is validated and drives the result; null
  // clears the games (round reverts to a single-game edit).
  if (body.game_results !== undefined) {
    const seq = normalizeGameResults(body.game_results);
    if (seq !== null && !isValidGameResults(seq)) {
      return NextResponse.json(
        { error: 'game_results must be 2–5 of W/L/D (e.g. "WLW").' },
        { status: 400 }
      );
    }
    updates.game_results = seq;
    if (seq !== null) updates.result = deriveResultFromGames(seq);
  }

  if (body.prizes_taken_player !== undefined)
    updates.prizes_taken_player = sanitizePrize(body.prizes_taken_player);
  if (body.prizes_taken_opponent !== undefined)
    updates.prizes_taken_opponent = sanitizePrize(body.prizes_taken_opponent);
  if (body.game_prizes !== undefined)
    updates.game_prizes = sanitizeGamePrizes(body.game_prizes);

  // Re-attribute the match to a different version of its deck. Null clears
  // the stamp; a version id must belong to the match's own deck.
  if (body.saved_deck_version_id !== undefined) {
    if (body.saved_deck_version_id === null) {
      updates.saved_deck_version_id = null;
    } else {
      const { data: match } = await supabase
        .from("matches")
        .select("saved_deck_id")
        .eq("id", id)
        .maybeSingle();
      if (!match) {
        return NextResponse.json({ error: "Match not found." }, { status: 404 });
      }
      const { data: version } = await supabase
        .from("deck_versions")
        .select("id")
        .eq("id", body.saved_deck_version_id)
        .eq("deck_id", match.saved_deck_id)
        .maybeSingle();
      if (!version) {
        return NextResponse.json(
          { error: "saved_deck_version_id does not belong to this match's deck." },
          { status: 400 }
        );
      }
      updates.saved_deck_version_id = version.id;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { error } = await supabase.from("matches").update(updates).eq("id", id);

  if (error) {
    console.error("[matches] update failed:", error);
    return NextResponse.json({ error: "Failed to update match." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

/**
 * DELETE /api/matches/[id]
 *
 * Deletes a match record. RLS enforces owner-only access.
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
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { error } = await supabase.from("matches").delete().eq("id", id);

  if (error) {
    console.error("[matches] delete failed:", error);
    return NextResponse.json({ error: "Failed to delete match." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
