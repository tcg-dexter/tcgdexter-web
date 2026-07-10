import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  normalizeGameResults,
  isValidGameResults,
  deriveResultFromGames,
  sanitizePrize,
  sanitizeGamePrizes,
} from "@/lib/bo3";
import { track } from "@/lib/analytics/track";

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
    saved_deck_version_id?: string | null;
    result?: string;
    opponent_name?: string;
    opponent_archetype?: string;
    opponent_deck_list?: string;
    notes?: string;
    played_at?: string;
    game_results?: string | null;
    prizes_taken_player?: number | null;
    prizes_taken_opponent?: number | null;
    game_prizes?: unknown;
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
      { error: 'game_results must be 2–5 of W/L/D (e.g. "WLW").' },
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

  // Version stamping: an explicit version must belong to this deck;
  // otherwise the match records the deck's latest version at log time.
  // Null-safe throughout — a deck with no versions yet just logs unstamped.
  let versionId: string | null = null;
  if (typeof body.saved_deck_version_id === "string") {
    const { data: version } = await supabase
      .from("deck_versions")
      .select("id")
      .eq("id", body.saved_deck_version_id)
      .eq("deck_id", saved_deck_id)
      .maybeSingle();
    if (!version) {
      return NextResponse.json(
        { error: "saved_deck_version_id does not belong to this deck." },
        { status: 400 }
      );
    }
    versionId = version.id;
  } else {
    const { data: latest } = await supabase
      .from("deck_versions")
      .select("id")
      .eq("deck_id", saved_deck_id)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    versionId = latest?.id ?? null;
  }

  const insertRow: Record<string, unknown> = {
    user_id: user.id,
    saved_deck_id,
    saved_deck_version_id: versionId,
    result: finalResult,
    opponent_name: opponent_name?.trim() || null,
    opponent_archetype: opponent_archetype?.trim() || null,
    opponent_deck_list: opponent_deck_list?.trim() || null,
    notes: notes?.trim() || null,
    // played_at is optional — null means the user chose not to record a date.
    played_at: played_at || null,
    prizes_taken_player: sanitizePrize(body.prizes_taken_player),
    prizes_taken_opponent: sanitizePrize(body.prizes_taken_opponent),
    game_prizes: sanitizeGamePrizes(body.game_prizes),
  };
  // Only attach game_results for Best-of-3 rounds so single-game inserts stay
  // unaffected (and keep working even if the migration hasn't landed yet).
  if (gameResults !== null) insertRow.game_results = gameResults;

  const { data, error } = await supabase
    .from("matches")
    .insert(insertRow)
    .select("id, result, opponent_archetype, played_at, created_at, saved_deck_version_id")
    .single();

  if (error) {
    console.error("[matches] insert failed:", error);
    return NextResponse.json({ error: "Failed to log match." }, { status: 500 });
  }

  void track(req, "match.logged", {
    result: finalResult,
    opponent_archetype: opponent_archetype?.trim() || null,
    bo3: gameResults !== null,
  });

  return NextResponse.json(data);
}
