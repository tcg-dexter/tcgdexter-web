import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parsePrizeCount } from "@/lib/matchPrizes";

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
 *   prizes_taken_player?: number (0-6),
 *   prizes_taken_opponent?: number (0-6)
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

  if (!result || !["win", "loss", "draw"].includes(result)) {
    return NextResponse.json(
      { error: "result must be win, loss, or draw." },
      { status: 400 }
    );
  }

  const prizesPlayer = parsePrizeCount(body.prizes_taken_player);
  const prizesOpponent = parsePrizeCount(body.prizes_taken_opponent);
  if (!prizesPlayer.ok || !prizesOpponent.ok) {
    return NextResponse.json(
      { error: "Prize counts must be integers between 0 and 6." },
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

  const { data, error } = await supabase
    .from("matches")
    .insert({
      user_id: user.id,
      saved_deck_id,
      result,
      opponent_name: opponent_name?.trim() || null,
      opponent_archetype: opponent_archetype?.trim() || null,
      opponent_deck_list: opponent_deck_list?.trim() || null,
      notes: notes?.trim() || null,
      // played_at is optional — null means the user chose not to record a date.
      played_at: played_at || null,
      prizes_taken_player: prizesPlayer.value,
      prizes_taken_opponent: prizesOpponent.value,
    })
    .select("id, result, opponent_archetype, played_at, created_at")
    .single();

  if (error) {
    console.error("[matches] insert failed:", error);
    return NextResponse.json({ error: "Failed to log match." }, { status: 500 });
  }

  return NextResponse.json(data);
}
