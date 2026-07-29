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
import { bumpMatchStreak, localDateInTz } from "@/lib/streak";
import { reconcileAchievements } from "@/lib/learn/achievements";
import { notifyBadgesUnlocked } from "@/lib/notifications/notify";

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
    game_prizes?: unknown;
    /** Client IANA timezone, for bucketing the daily-logging streak. */
    tz?: string;
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

  // Matches are owner-only: RLS on saved_decks lets this SELECT through for
  // any PUBLIC deck (not just the caller's own), so it alone doesn't stop
  // someone from logging a match against another trainer's deck — the
  // explicit user_id check below does.
  const { data: deck } = await supabase
    .from("saved_decks")
    .select("id, user_id")
    .eq("id", saved_deck_id)
    .maybeSingle();

  if (!deck) {
    return NextResponse.json({ error: "Deck not found." }, { status: 404 });
  }
  if (deck.user_id !== user.id) {
    return NextResponse.json(
      { error: "You can only log matches for your own decks." },
      { status: 403 },
    );
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
    game_prizes: sanitizeGamePrizes(body.game_prizes),
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

  void track(req, "match.logged", {
    result: finalResult,
    opponent_archetype: opponent_archetype?.trim() || null,
    bo3: gameResults !== null,
  });

  // Daily-logging streak. The client's timezone decides the calendar day;
  // the day itself is the server's "now" in that zone (not a client-sent
  // date), so it can't be spoofed. Non-fatal — a null streak never blocks
  // the logged match from being returned.
  const tz = typeof body.tz === "string" ? body.tz : "UTC";
  const streak = await bumpMatchStreak(supabase, localDateInTz(new Date(), tz), tz);

  // Award any count-based badges this log just unlocked (First Match,
  // match-grind milestones). Internally error-safe; awaited so it runs to
  // completion before the serverless function freezes.
  const newlyAwarded = await reconcileAchievements(supabase, user.id);
  void notifyBadgesUnlocked(user.id, newlyAwarded);

  return NextResponse.json({ ...data, streak });
}
