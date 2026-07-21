import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { normalizePerspective, parseBattleLog } from "@/lib/battle-log";
import { replay } from "@/lib/engine";
import { extractMatchFeatures, turnQualityFlags } from "@/lib/ml/features";
import { replayTurnViews } from "@/lib/ml/features/replayView";
import { buildCoachReport } from "@/lib/ml/coach";
import type { CoachInsight, CoachReport } from "@/lib/ml/coach";
import { swingInsights } from "@/lib/ml/coach/swings";
import { cachedValueArtifact, valueCurve } from "@/lib/ml/valueCurve";
import type { WinProbPoint } from "@/lib/ml/winprob";
import { loadBattleWithAccess } from "@/lib/battles/access";

/**
 * GET /api/battles/[id]/analysis
 *
 * The user-facing game review: per-turn win-probability curve from the
 * board-aware value model (the same model the AI player runs on) plus
 * deterministic coach insights, for any battle the viewer may see
 * (owner always; others when the deck AND owner profile are public —
 * lib/battles/access.ts, same rule as the battles page).
 *
 * Computed on demand from battle_log_raw: no schema change, and the curve
 * always reflects the currently promoted model. The whole pipeline
 * (parse → replay → encode → 267 trees × ~20 turns) runs in tens of ms.
 *
 * `low_confidence` marks curves the model shouldn't editorialize over:
 * replay error-diagnostics, or too many cards the catalog can't resolve
 * (they encode as inert blanks). The UI shows the curve dimmed and the
 * swing insights are suppressed.
 */

const CARD_COVERAGE_FLOOR = 0.7;

export interface BattleAnalysisResponse {
  match_id: string;
  report: CoachReport;
  win_prob: {
    model_version: string;
    curve: WinProbPoint[];
    low_confidence: boolean;
  } | null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const admin = createAdminClient();

  const supabase = await createClient();
  const {
    data: { user: viewer },
  } = await supabase.auth.getUser();

  const access = await loadBattleWithAccess(admin, id, viewer?.id ?? null);
  if (!access.allowed || !access.match) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const { match } = access;
  if (!match.battle_log_raw || !match.player_handle) {
    return NextResponse.json({ error: "This match has no battle log." }, { status: 400 });
  }

  let normalized;
  let replayResult;
  let extraction;
  try {
    normalized = normalizePerspective(parseBattleLog(match.battle_log_raw), match.player_handle);
    replayResult = replay(normalized);
    extraction = extractMatchFeatures(normalized, replayResult);
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
  const report = buildCoachReport(extraction.match, flagged);

  let winProb: BattleAnalysisResponse["win_prob"] = null;
  const artifact = cachedValueArtifact();
  if (artifact) {
    const { views, cardCoverage } = replayTurnViews(normalized, replayResult, access.deckList);
    const curve = valueCurve(artifact, views);
    if (curve.length > 0) {
      const lowConfidence =
        cardCoverage < CARD_COVERAGE_FLOOR ||
        replayResult.diagnostics.some((d) => d.severity === "error");
      winProb = {
        model_version: artifact.model_version,
        curve,
        low_confidence: lowConfidence,
      };
      if (!lowConfidence) {
        const swings: CoachInsight[] = swingInsights(curve);
        report.insights = [...swings, ...report.insights];
      }
    }
  }

  const response: BattleAnalysisResponse = {
    match_id: match.id,
    report,
    win_prob: winProb,
  };
  return NextResponse.json(response);
}
