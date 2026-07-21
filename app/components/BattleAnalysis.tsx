"use client";

// User-facing game review — the first product surface powered by the
// board-aware value model (the same model the AI player runs on). Fetches
// /api/battles/[id]/analysis and renders the per-turn win-probability curve
// plus the coach's top insights. Renders NOTHING on any failure: the battle
// page must never degrade because analysis couldn't run.

import { useEffect, useState } from "react";
import WinProbSparkline from "@/app/components/WinProbSparkline";
import type { BattleAnalysisResponse } from "@/app/api/battles/[id]/analysis/route";

const SEVERITY_STYLES: Record<string, string> = {
  warning: "bg-red-100 text-red-800",
  suggestion: "bg-yellow-100 text-yellow-800",
  info: "bg-surface text-text-secondary",
};

const MAX_INSIGHTS = 4;

export default function BattleAnalysis({ matchId }: { matchId: string }) {
  const [data, setData] = useState<BattleAnalysisResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/battles/${matchId}/analysis`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body) setData(body as BattleAnalysisResponse);
      })
      .catch(() => {
        /* silent — analysis is additive, never load-bearing */
      });
    return () => {
      cancelled = true;
    };
  }, [matchId]);

  if (!data) return null;
  const curve = data.win_prob;
  const insights = data.report.insights.slice(0, MAX_INSIGHTS);
  if (!curve && insights.length === 0) return null;

  return (
    <div className="mx-auto w-full max-w-2xl px-4">
      <div className="mt-8 mb-2">
        <div className="flex items-baseline gap-3">
          <h2 className="text-xl font-black uppercase tracking-[0.15em] text-text-primary">
            Analysis
          </h2>
          <span className="h-px flex-1 bg-text-primary/15" />
          <span className="text-[11px] font-semibold uppercase tracking-widest text-text-muted">
            Experimental
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-black/8 bg-white/90 p-4 shadow-sm">
        {curve && (
          <>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-xs font-semibold text-text-secondary">
                Estimated win probability by turn
              </span>
              <span className="text-[10px] text-text-muted">
                {curve.model_version}
                {curve.low_confidence ? " · low confidence" : ""}
              </span>
            </div>
            <WinProbSparkline curve={curve.curve} dimmed={curve.low_confidence} />
          </>
        )}

        {insights.length > 0 && (
          <ul className={`flex flex-col gap-2 ${curve ? "mt-4" : ""}`}>
            {insights.map((insight, i) => (
              <li key={`${insight.code}-${insight.turn_number ?? "match"}-${i}`}>
                <div className="flex items-start gap-2">
                  <span
                    className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      SEVERITY_STYLES[insight.severity] ?? SEVERITY_STYLES.info
                    }`}
                  >
                    {insight.turn_number !== null ? `Turn ${insight.turn_number}` : "Match"}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-text-primary">{insight.title}</div>
                    <div className="text-xs leading-relaxed text-text-secondary">
                      {insight.detail}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 text-[10px] leading-relaxed text-text-muted">
          Estimated by our AI player&apos;s evaluation model from the board state each turn —
          it can&apos;t see either hand&apos;s hidden cards, and it&apos;s still learning.
        </div>
      </div>
    </div>
  );
}
