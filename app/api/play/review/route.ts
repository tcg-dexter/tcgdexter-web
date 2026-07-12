import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { IllegalMoveError, SimDeckError } from "@/lib/engine/sim";
import type { GameTranscript } from "@/lib/engine/sim";
import { reviewFromTranscript } from "@/lib/ml/gameReview";

/**
 * POST /api/play/review — post-game coach review for a finished AI-player
 * game (admin-gated). Body: { transcript }. The transcript is rebuilt
 * deterministically and analyzed with the same coach heuristics +
 * win-prob curve used for imported real matches.
 */

const TRANSCRIPT_MOVES_MAX = 800;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Auth required" }, { status: 401 });

  const { data: me } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle<{ is_admin: boolean }>();
  if (!me?.is_admin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  let body: { transcript?: GameTranscript };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const transcript = body.transcript;
  if (!transcript || typeof transcript !== "object" || !Array.isArray(transcript.moves)) {
    return NextResponse.json({ error: "transcript is required" }, { status: 400 });
  }
  if (transcript.moves.length > TRANSCRIPT_MOVES_MAX) {
    return NextResponse.json({ error: "Transcript too long" }, { status: 400 });
  }

  try {
    return NextResponse.json(reviewFromTranscript(transcript));
  } catch (e) {
    if (e instanceof IllegalMoveError || e instanceof SimDeckError) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    return NextResponse.json(
      { error: `Review failed: ${e instanceof Error ? e.message : e}` },
      { status: 500 },
    );
  }
}
