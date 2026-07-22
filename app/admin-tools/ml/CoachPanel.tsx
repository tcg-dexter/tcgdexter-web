"use client";

import { useState } from "react";
import type { CoachResponse } from "@/app/api/coach/[matchId]/route";
import WinProbSparkline from "@/app/components/WinProbSparkline";

interface MatchOption {
  id: string;
  played_at: string | null;
  opponent_archetype: string | null;
  result: string | null;
}

const SEVERITY_STYLES: Record<string, string> = {
  warning: "bg-red-100 text-red-800",
  suggestion: "bg-yellow-100 text-yellow-800",
  info: "bg-surface text-text-secondary",
};

export default function CoachPanel({ matches }: { matches: MatchOption[] }) {
  const [selected, setSelected] = useState(matches[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CoachResponse | null>(null);

  async function run() {
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/coach/${selected}`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body as CoachResponse);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  if (matches.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-black/15 bg-surface p-6 text-center text-sm text-text-muted">
        No logged matches with battle logs on this account yet — import a TCG
        Live log to try the coach.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-black/8 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-black/15 bg-white px-2 py-1.5 text-xs text-text-primary"
        >
          {matches.map((m) => (
            <option key={m.id} value={m.id}>
              {[
                m.played_at ? new Date(m.played_at).toLocaleDateString() : "undated",
                m.opponent_archetype ? `vs ${m.opponent_archetype}` : null,
                m.result,
              ]
                .filter(Boolean)
                .join(" · ")}
            </option>
          ))}
        </select>
        <button
          onClick={run}
          disabled={loading}
          className="rounded-lg border border-transparent bg-black px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {loading ? "Analyzing…" : "Run Coach"}
        </button>
      </div>

      {error && <p className="mt-3 text-xs text-red-700">{error}</p>}

      {data && (
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-wrap gap-3 text-xs text-text-secondary">
            <span>
              Prizes {data.report.summary.prizes_player ?? "—"}–
              {data.report.summary.prizes_opponent ?? "—"}
            </span>
            <span>{data.report.summary.player_turns} player turns</span>
            <span>{data.report.summary.turns_missed_energy} missed energy</span>
            <span>{data.report.summary.passive_turns} passive</span>
          </div>

          {data.win_prob ? (
            <div>
              <div className="mb-1 flex items-baseline justify-between">
                <h3 className="text-xs font-semibold text-text-primary">Win probability by turn</h3>
                <span className="font-mono text-[10px] text-text-muted">
                  {data.win_prob.model_version}
                </span>
              </div>
              <WinProbSparkline curve={data.win_prob.curve} />
            </div>
          ) : (
            <p className="text-xs text-text-muted">
              No win-prob model live in the registry — showing heuristics only.
            </p>
          )}

          <div className="flex flex-col gap-2">
            {data.report.insights.length === 0 && (
              <p className="text-xs text-text-muted">No insights — a clean game.</p>
            )}
            {data.report.insights.map((insight, i) => (
              <div key={`${insight.code}-${i}`} className="rounded-lg border border-black/8 p-3">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${SEVERITY_STYLES[insight.severity]}`}
                  >
                    {insight.severity}
                  </span>
                  {insight.turn_number !== null && (
                    <span className="text-[10px] text-text-muted">turn {insight.turn_number}</span>
                  )}
                  <span className="text-xs font-semibold text-text-primary">{insight.title}</span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-text-secondary">{insight.detail}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
