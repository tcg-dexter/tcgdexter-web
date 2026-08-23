import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizePerspective, parseBattleLog } from "@/lib/battle-log";
import { replay } from "@/lib/engine";
import { extractBattleFeatures, turnQualityFlags } from "@/lib/ml/features";
import type { BattleLogFeatures } from "@/lib/ml/features";
import { buildCoachReport } from "@/lib/ml/coach";
import type { CoachReport } from "@/lib/ml/coach";
import { readWinProbArtifact, winProbCurve } from "@/lib/ml/winprob";
import type { WinProbPoint } from "@/lib/ml/winprob";

/**
 * POST /api/coach/[battleId]
 *
 * Coach v1 (ML pipeline Phase 2). Admin-gated during rollout; the battle
 * itself is loaded through the caller's own client, so RLS scopes it to
 * battles the caller owns. Returns deterministic heuristic insights plus
 * a win-probability curve when a trained artifact is live in the registry.
 */

export interface CoachResponse {
  battle_id: string;
  report: CoachReport;
  features: BattleLogFeatures;
  win_prob: {
    model_version: string;
    curve: WinProbPoint[];
  } | null;
}

interface BattleRow {
  id: string;
  result: string | null;
  battle_log_raw: string | null;
  player_handle: string | null;
  saved_deck_id: string | null;
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ battleId: string }> },
) {
  const { battleId } = await ctx.params;
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

  const { data: battle } = await supabase
    .from("matches")
    .select("id, result, battle_log_raw, player_handle, saved_deck_id")
    .eq("id", battleId)
    .maybeSingle<BattleRow>();
  if (!battle) return NextResponse.json({ error: "Battle not found" }, { status: 404 });
  if (!battle.battle_log_raw || !battle.player_handle) {
    return NextResponse.json(
      { error: "Battle has no imported battle log — the coach needs one" },
      { status: 400 },
    );
  }

  let extraction;
  let normalized;
  try {
    normalized = normalizePerspective(parseBattleLog(battle.battle_log_raw), battle.player_handle);
    extraction = extractBattleFeatures(normalized, replay(normalized));
  } catch (e) {
    return NextResponse.json(
      { error: `Battle log could not be analyzed: ${e instanceof Error ? e.message : e}` },
      { status: 422 },
    );
  }

  const flagged = extraction.turns.map((t) => ({
    ...t.features,
    ...turnQualityFlags(t.features, t.endState),
  }));
  const report = buildCoachReport(extraction.battle, flagged);

  let winProb: CoachResponse["win_prob"] = null;
  const artifact = readWinProbArtifact();
  if (artifact) {
    let archetypeName: string | null = null;
    if (battle.saved_deck_id) {
      const { data: deck } = await supabase
        .from("saved_decks")
        .select("archetype_name")
        .eq("id", battle.saved_deck_id)
        .maybeSingle<{ archetype_name: string | null }>();
      archetypeName = deck?.archetype_name ?? null;
    }
    winProb = {
      model_version: artifact.model_version,
      curve: winProbCurve(
        artifact,
        { went_first: extraction.battle.went_first, archetype_name: archetypeName },
        extraction.turns.map((t) => t.features),
      ),
    };
  }

  const response: CoachResponse = {
    battle_id: battle.id,
    report,
    features: extraction.battle,
    win_prob: winProb,
  };
  return NextResponse.json(response);
}
