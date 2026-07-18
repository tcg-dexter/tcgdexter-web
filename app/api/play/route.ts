import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cardImageUrlForAnyName } from "@/lib/primaryCardImage";
import {
  applyHumanMove,
  humanOptions,
  rebuildSession,
  serializeView,
  startGame,
  viewFor,
  IllegalMoveError,
  SimDeckError,
  DIFFICULTY_SKILL,
} from "@/lib/engine/sim";
import type {
  AiAction,
  ClientView,
  GameOutcome,
  GameSession,
  GameTranscript,
  InteractiveMove,
  SessionStatus,
} from "@/lib/engine/sim";

/**
 * POST /api/play — the AI player (admin-gated practice mode).
 *
 * Stateless: the transcript is the game state. The client sends it back
 * with each move; the server replays it (deterministic engine + seed),
 * validates the human's move, runs the AI's reply, and returns the
 * redacted view + the human's next legal options.
 *
 * Body:
 *   { action: "start", deck_human, deck_ai, skill?, seed? }
 *   { action: "move", transcript, move }
 */

const DECK_TEXT_MAX = 8000;
const TRANSCRIPT_MOVES_MAX = 800;

export interface PlayResponse {
  status: SessionStatus;
  transcript: GameTranscript;
  view: ClientView;
  options: InteractiveMove[];
  ai_actions: AiAction[];
  outcome: GameOutcome | null;
  /** Card name → image URL for everything visible in the view, so the
   *  client renders art without shipping the card catalog. */
  images: Record<string, string | null>;
}

function collectImages(
  view: ClientView,
  options: InteractiveMove[],
): Record<string, string | null> {
  const names = new Set<string>();
  for (const c of view.hand) names.add(c.name);
  for (const c of view.discard) names.add(c.name);
  for (const c of view.opponent.discard) names.add(c.name);
  if (view.stadium) names.add(view.stadium.name);
  for (const board of [view.board, view.opponent.board]) {
    for (const mon of [board.active, ...board.bench]) {
      if (!mon) continue;
      names.add(mon.name);
      for (const s of mon.stack) names.add(s);
      for (const t of mon.tools) names.add(t);
    }
  }
  // Search-picker choices (trainer effects) need art too — the names ride
  // on the moves themselves.
  for (const m of options) {
    if (m.kind === "play_trainer") {
      for (const n of m.deckCardNames ?? []) names.add(n);
      if (m.discardPickName) names.add(m.discardPickName);
    } else if (m.kind === "use_stadium" && m.deckCardName) {
      names.add(m.deckCardName);
    }
  }
  const images: Record<string, string | null> = {};
  names.forEach((name) => {
    images[name] = cardImageUrlForAnyName(name);
  });
  return images;
}

function respond(session: GameSession): NextResponse {
  const view = serializeView(viewFor(session.state, "player"));
  const options = humanOptions(session);
  const payload: PlayResponse = {
    status: session.status,
    transcript: session.transcript,
    view,
    options,
    ai_actions: session.aiActions,
    outcome: session.outcome,
    images: collectImages(view, options),
  };
  return NextResponse.json(payload);
}

function clampSkill(raw: unknown): number {
  if (typeof raw === "string" && raw in DIFFICULTY_SKILL) {
    return DIFFICULTY_SKILL[raw as keyof typeof DIFFICULTY_SKILL];
  }
  const n = typeof raw === "number" ? raw : DIFFICULTY_SKILL.medium;
  return Math.min(1, Math.max(0, n));
}

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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    if (body.action === "start") {
      const deckHuman = typeof body.deck_human === "string" ? body.deck_human.trim() : "";
      const deckAi = typeof body.deck_ai === "string" ? body.deck_ai.trim() : "";
      if (!deckHuman || !deckAi) {
        return NextResponse.json({ error: "deck_human and deck_ai are required" }, { status: 400 });
      }
      if (deckHuman.length > DECK_TEXT_MAX || deckAi.length > DECK_TEXT_MAX) {
        return NextResponse.json({ error: "Deck list too large" }, { status: 400 });
      }
      const session = startGame({
        deckHuman,
        deckAi,
        skill: clampSkill(body.skill),
        seed: typeof body.seed === "number" || typeof body.seed === "string" ? body.seed : undefined,
      });
      return respond(session);
    }

    if (body.action === "move") {
      const transcript = body.transcript as GameTranscript | undefined;
      const move = body.move as InteractiveMove | undefined;
      if (!transcript || typeof transcript !== "object" || !Array.isArray(transcript.moves)) {
        return NextResponse.json({ error: "transcript is required" }, { status: 400 });
      }
      if (transcript.moves.length > TRANSCRIPT_MOVES_MAX) {
        return NextResponse.json({ error: "Transcript too long" }, { status: 400 });
      }
      if (!move || typeof move !== "object" || typeof (move as { kind?: unknown }).kind !== "string") {
        return NextResponse.json({ error: "move is required" }, { status: 400 });
      }
      const session = rebuildSession(transcript);
      applyHumanMove(session, move);
      return respond(session);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    if (e instanceof IllegalMoveError || e instanceof SimDeckError) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    return NextResponse.json(
      { error: `Play failed: ${e instanceof Error ? e.message : e}` },
      { status: 500 },
    );
  }
}
