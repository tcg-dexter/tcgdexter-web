import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parsePrizeCount } from "@/lib/matchPrizes";

/**
 * PATCH /api/matches/[id]
 *
 * Edits a match record. RLS enforces owner-only access.
 * Accepts any combination of: result, opponent_name, opponent_archetype,
 * opponent_deck_list, notes, played_at, prizes_taken_player,
 * prizes_taken_opponent.
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
    prizes_taken_player?: number | null;
    prizes_taken_opponent?: number | null;
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

  if (body.prizes_taken_player !== undefined) {
    const parsed = parsePrizeCount(body.prizes_taken_player);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: "prizes_taken_player must be an integer between 0 and 6." },
        { status: 400 }
      );
    }
    updates.prizes_taken_player = parsed.value;
  }
  if (body.prizes_taken_opponent !== undefined) {
    const parsed = parsePrizeCount(body.prizes_taken_opponent);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: "prizes_taken_opponent must be an integer between 0 and 6." },
        { status: 400 }
      );
    }
    updates.prizes_taken_opponent = parsed.value;
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
