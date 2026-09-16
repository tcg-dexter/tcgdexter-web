import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createBoardEvaluator } from "@/lib/ml/botEvaluator";
import { coachGame, type CoachedDecision } from "@/lib/ml/strategist/coachGame";
import type { LogRow } from "@/lib/ml/strategist/logDecisions";

/**
 * POST /api/admin/coach  { matchId, rollouts?, horizon?, seed? }
 *
 * Admin-only. Grades one imported battle log decision by decision and returns
 * the CoachedGame. Read-only: nothing here writes.
 *
 * The admin check is repeated here on purpose. The page gate at
 * /admin-tools/coach is a redirect for humans; this route is reachable
 * directly and has to stand on its own.
 *
 * WHY createBoardEvaluator AND NOT createBotEvaluator
 *
 * createBotEvaluator falls back to the snapshot model when the board artifact
 * is missing. That fallback would be silent and wrong here: every severity
 * label is a quantile of a regret distribution measured against the BOARD
 * evaluator's Q (DEFAULT_SEVERITY, 271 logs), so grading with a different Q
 * prints labels that mean nothing. scripts/ml/coach_report.ts refuses the same
 * fallback for the same reason, and the CLI and this route are supposed to
 * agree about a log. So: no artifact, no grade.
 */

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const ROLLOUTS_DEFAULT = 16;
const ROLLOUTS_MIN = 4;
const ROLLOUTS_MAX = 32;
const HORIZON_DEFAULT = 6;
const HORIZON_MIN = 1;
const HORIZON_MAX = 16;
const SEED_DEFAULT = 1;

/** A decision as returned to the client. `qChosen`/`qBest` are the search's raw
 *  values — debugging aids, not product — so they ride only on ?debug=1. */
export type CoachedDecisionPublic = Omit<CoachedDecision, "qChosen" | "qBest"> &
  Partial<Pick<CoachedDecision, "qChosen" | "qBest">>;

/** ScanStats with its Maps flattened. A Map JSON.stringifies to `{}`, so
 *  missBy/unmatchedBy would arrive empty if passed through untouched. */
export interface CoachScanStats {
  logsUsed: number;
  logsFailed: number;
  decisions: number;
  matched: number;
  trivial: number;
  yielded: number;
  missBy: Record<string, number>;
  unmatchedBy: Record<string, number>;
}

export interface CoachRunResponse {
  logId: string;
  decisions: CoachedDecisionPublic[];
  coverage: number;
  meanCapture: number | null;
  blunders: CoachedDecisionPublic[];
  highlights: CoachedDecisionPublic[];
  stats: CoachScanStats;
  /** Echoed so a run is reproducible, and so a persisted result can be keyed
   *  by the parameters that produced it without reshaping this payload. */
  params: { rollouts: number; horizon: number | null; seed: number };
}

interface MatchRow {
  id: string;
  battle_log_raw: string | null;
  player_handle: string | null;
  saved_deck_id: string | null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

function strip(d: CoachedDecision, debug: boolean): CoachedDecisionPublic {
  if (debug) return d;
  const { qChosen: _q, qBest: _b, ...rest } = d;
  return rest;
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

  let body: { matchId?: unknown; rollouts?: unknown; horizon?: unknown; seed?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const matchId = typeof body.matchId === "string" ? body.matchId.trim() : "";
  if (!matchId) {
    return NextResponse.json({ error: "matchId is required" }, { status: 400 });
  }

  const rollouts =
    typeof body.rollouts === "number" && Number.isFinite(body.rollouts)
      ? clamp(body.rollouts, ROLLOUTS_MIN, ROLLOUTS_MAX)
      : ROLLOUTS_DEFAULT;
  // null is meaningful — it means roll out to the end of the game rather than
  // cutting off and asking the evaluator. The CLI spells it `--horizon none`.
  const horizon =
    body.horizon === null
      ? null
      : typeof body.horizon === "number" && Number.isFinite(body.horizon)
        ? clamp(body.horizon, HORIZON_MIN, HORIZON_MAX)
        : HORIZON_DEFAULT;
  const seed =
    typeof body.seed === "number" && Number.isFinite(body.seed)
      ? Math.floor(body.seed)
      : SEED_DEFAULT;

  const evaluate = createBoardEvaluator();
  if (!evaluate) {
    return NextResponse.json(
      {
        error:
          "No value artifact is live — refusing to grade with a fallback evaluator, " +
          "because the severity thresholds are calibrated to this one.",
      },
      { status: 503 },
    );
  }

  // Service-role read: the picker lists every admin-visible log, not just the
  // caller's own, and `matches` is RLS-scoped to the owner.
  const admin = createAdminClient();
  const { data: match, error: matchError } = await admin
    .from("matches")
    .select("id, battle_log_raw, player_handle, saved_deck_id")
    .eq("id", matchId)
    .maybeSingle<MatchRow>();

  if (matchError) {
    return NextResponse.json({ error: matchError.message }, { status: 500 });
  }
  if (!match) {
    return NextResponse.json({ error: "Battle not found" }, { status: 404 });
  }
  if (!match.battle_log_raw || !match.player_handle) {
    return NextResponse.json(
      { error: "Battle has no imported battle log — the coach needs one" },
      { status: 400 },
    );
  }

  // Without the deck list the reconstructed deck is weaker and coverage drops,
  // so it is worth fetching, but it is not required.
  let deckList: string | null = null;
  if (match.saved_deck_id) {
    const { data: deck } = await admin
      .from("saved_decks")
      .select("deck_list")
      .eq("id", match.saved_deck_id)
      .maybeSingle<{ deck_list: string | null }>();
    deckList = deck?.deck_list ?? null;
  }

  const row: LogRow = {
    id: match.id,
    battle_log_raw: match.battle_log_raw,
    player_handle: match.player_handle,
    deck_list: deckList,
  };

  const debug = new URL(req.url).searchParams.get("debug") === "1";

  try {
    const game = coachGame(row, { evaluate, rollouts, horizon, seed });

    // scanLog does not throw on a log it cannot read — it counts the failure
    // and returns, leaving an empty game. Surface that as 422 rather than
    // rendering a confident "0 decisions, 0% coverage" page.
    if (game.stats.logsUsed === 0) {
      return NextResponse.json(
        { error: "Battle log could not be replayed — the engine could not reconstruct it" },
        { status: 422 },
      );
    }

    const payload: CoachRunResponse = {
      logId: game.logId,
      decisions: game.decisions.map((d) => strip(d, debug)),
      coverage: game.coverage,
      meanCapture: game.meanCapture,
      blunders: game.blunders.map((d) => strip(d, debug)),
      highlights: game.highlights.map((d) => strip(d, debug)),
      stats: {
        logsUsed: game.stats.logsUsed,
        logsFailed: game.stats.logsFailed,
        decisions: game.stats.decisions,
        matched: game.stats.matched,
        trivial: game.stats.trivial,
        yielded: game.stats.yielded,
        missBy: Object.fromEntries(game.stats.missBy),
        unmatchedBy: Object.fromEntries(game.stats.unmatchedBy),
      },
      params: { rollouts, horizon, seed },
    };
    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json(
      { error: `Coaching failed: ${e instanceof Error ? e.message : e}` },
      { status: 500 },
    );
  }
}
