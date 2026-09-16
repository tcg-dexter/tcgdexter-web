"use client";

import { useState } from "react";

import type { CoachRunResponse } from "@/app/api/admin/coach/route";
import type { CoachLogOption } from "./page";
import DecisionTimeline from "./DecisionTimeline";
import GameSummary from "./GameSummary";

const ROLLOUTS_DEFAULT = 16;
const SEED_DEFAULT = 1;

/** ISO slice rather than toLocaleDateString: this renders on the server too,
 *  and a locale-dependent string is a hydration mismatch waiting to happen. */
function day(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "undated";
}

function label(log: CoachLogOption): string {
  const parts = [
    day(log.playedAt),
    `${log.playerHandle ?? "?"} vs ${log.opponentHandle ?? "?"}`,
    log.result ?? "—",
  ];
  if (log.opponentArchetype) parts.push(log.opponentArchetype);
  if (log.totalTurns !== null) parts.push(`${log.totalTurns} turns`);
  if (!log.hasDeckList) parts.push("no deck list");
  return parts.join(" · ");
}

export default function CoachClient({ logs }: { logs: CoachLogOption[] }) {
  const [selected, setSelected] = useState<string>(logs[0]?.id ?? "");
  const [rollouts, setRollouts] = useState<number>(ROLLOUTS_DEFAULT);
  const [seed, setSeed] = useState<number>(SEED_DEFAULT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CoachRunResponse | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  const chosen = logs.find((l) => l.id === selected) ?? null;

  async function run() {
    if (!selected) return;
    setLoading(true);
    setError(null);
    const startedAt = Date.now();
    try {
      const res = await fetch("/api/admin/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: selected, rollouts, seed }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body as CoachRunResponse);
      setElapsed((Date.now() - startedAt) / 1000);
    } catch (e) {
      setData(null);
      setElapsed(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  if (logs.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-black/15 bg-surface p-6 text-center text-sm text-text-muted dark:border-white/15 dark:bg-surface-2">
        No imported battle logs to grade yet — the coach needs a match with a
        battle log and a player handle.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-black/8 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-surface-elevated">
        <label
          htmlFor="coach-log"
          className="block text-[11px] font-semibold uppercase tracking-wide text-text-muted"
        >
          battle log
        </label>
        <select
          id="coach-log"
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setData(null);
            setError(null);
            setElapsed(null);
          }}
          className="mt-1.5 w-full rounded-lg border border-black/15 bg-white px-2.5 py-1.5 text-xs text-text-primary dark:border-white/15 dark:bg-surface-2"
        >
          {logs.map((l) => (
            <option key={l.id} value={l.id}>
              {label(l)}
            </option>
          ))}
        </select>

        {chosen && !chosen.hasDeckList && (
          <p className="mt-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
            No deck list is linked to this battle. The reconstructed deck will be weaker
            and coverage will be lower than it would otherwise be.
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <NumberField
            id="coach-rollouts"
            label="rollouts"
            value={rollouts}
            min={4}
            max={32}
            onChange={setRollouts}
          />
          <NumberField
            id="coach-seed"
            label="seed"
            value={seed}
            min={0}
            max={999999}
            onChange={setSeed}
          />
          <button
            type="button"
            onClick={run}
            disabled={loading || !selected}
            className="rounded-lg border border-transparent bg-black px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {loading ? "Grading…" : "Grade log"}
          </button>
          {elapsed !== null && !loading && (
            <span className="text-[11px] text-text-muted">
              graded in {elapsed.toFixed(1)}s
            </span>
          )}
        </div>

        <p className="mt-2 text-[10px] leading-relaxed text-text-muted">
          More rollouts narrow every error bar and cost time. The first run after a cold
          start is slow — it loads the card catalog and the value artifact. Re-running with
          the same seed gives identical output.
        </p>

        {error && (
          <p className="mt-3 text-xs text-red-700 dark:text-red-400">{error}</p>
        )}
      </div>

      {data && (
        <>
          <GameSummary game={data} />
          <DecisionTimeline decisions={data.decisions} />
          <p className="text-[10px] leading-relaxed text-text-muted">
            Move values assume play continues at the rollout pilot&rsquo;s strength, so a
            setup play whose payoff needs strong follow-up is undervalued. Decisions whose
            cost does not clear its own error bar are shown without a judgement.
          </p>
        </>
      )}
    </div>
  );
}

function NumberField({
  id,
  label: text,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[11px] font-semibold uppercase tracking-wide text-text-muted"
      >
        {text}
      </label>
      <input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.floor(n))));
        }}
        className="mt-1.5 w-20 rounded-lg border border-black/15 bg-white px-2.5 py-1.5 text-xs tabular-nums text-text-primary dark:border-white/15 dark:bg-surface-2"
      />
    </div>
  );
}
