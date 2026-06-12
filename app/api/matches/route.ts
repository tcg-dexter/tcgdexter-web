import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  normalizeGameResults,
  isValidGameResults,
  deriveResultFromGames,
} from "@/lib/bo3";

/** Clamp a prize count to an integer 0–6, or null when absent/invalid. */
function sanitizePrize(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  if (Number.isNaN(n)) return null;
  return Math.max(0, Math.min(6, Math.trunc(n)));
}

/**
 * POST /api/matches
 *
 * Logs a match for the authenticated user's saved deck.
 *
 * Body: {
 *   saved_deck_id: string (uuid),
 *   result: "win" | "loss" | "draw",
 *   opponent_name?: string,
 *   opponent_archetype?: string,
 *   opponent_deck_list?: string,
 *   notes?: string,
 *   played_at?: string (ISO timestamp, defaults to now),
 *   game_results?: string (Best-of-3 sequence, e.g. "WLW"; derives result)
 * }
 */
export async function POST(req: Request) {
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
    saved_deck_id?: string;
    result?: string;
    opponent_name?: string;
    opponent_archetype?: string;
    opponent_deck_list?: string;
    notes?: string;
    played_at?: string;
    game_results?: string | null;
    prizes_taken_player?: number | null;
    prizes_taken_opponent?: number | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { saved_deck_id, result, opponent_name, opponent_archetype, opponent_deck_list, notes, played_at } = body;

  if (!saved_deck_id) {
    return NextResponse.json({ error: "saved_deck_id is required." }, { status: 400 });
  }

  // Best-of-3: validate the sequence and derive the authoritative result from
  // it (so result + game_results can't disagree). Single games leave it null.
  const gameResults = normalizeGameResults(body.game_results);
  if (gameResults !== null && !isValidGameResults(gameResults)) {
    return NextResponse.json(
      { error: 'game_results must be 2–5 of W/L (e.g. "WLW").' },
      { status: 400 }
    );
  }
  const finalResult = gameResults !== null ? deriveResultFromGames(gameResults) : result;

  if (!finalResult || !["win", "loss", "draw"].includes(finalResult)) {
    return NextResponse.json(
      { error: "result must be win, loss, or draw." },
      { status: 400 }
    );
  }

  // Verify the deck belongs to the user (RLS handles this, but a friendly
  // error is better than a silent no-op from a FK violation).
  const { data: deck } = await supabase
    .from("saved_decks")
    .select("id")
    .eq("id", saved_deck_id)
    .maybeSingle();

  if (!deck) {
    return NextResponse.json({ error: "Deck not found." }, { status: 404 });
  }

  const insertRow: Record<string, unknown> = {
    user_id: user.id,
    saved_deck_id,
    result: finalResult,
    opponent_name: opponent_name?.trim() || null,
    opponent_archetype: opponent_archetype?.trim() || null,
    opponent_deck_list: opponent_deck_list?.trim() || null,
    notes: notes?.trim() || null,
    // played_at is optional — null means the user chose not to record a date.
    played_at: played_at || null,
    prizes_taken_player: sanitizePrize(body.prizes_taken_player),
    prizes_taken_opponent: sanitizePrize(body.prizes_taken_opponent),
  };
  // Only attach game_results for Best-of-3 rounds so single-game inserts stay
  // unaffected (and keep working even if the migration hasn't landed yet).
  if (gameResults !== null) insertRow.game_results = gameResults;

  const { data, error } = await supabase
    .from("matches")
    .insert(insertRow)
    .select("id, result, opponent_archetype, played_at, created_at")
    .single();

  if (error) {
    console.error("[matches] insert failed:", error);
    return NextResponse.json({ error: "Failed to log match." }, { status: 500 });
  }

  return NextResponse.json(data);
}
