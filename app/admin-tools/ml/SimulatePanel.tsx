"use client";

import { useState } from "react";
import type { SimulateResponse } from "@/app/api/simulate/route";

const N_OPTIONS = [100, 200, 500];

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

export default function SimulatePanel() {
  const [deckA, setDeckA] = useState("");
  const [deckB, setDeckB] = useState("");
  const [n, setN] = useState(200);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SimulateResponse | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deck_a: deckA, deck_b: deckB, n }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body as SimulateResponse);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-black/8 bg-white p-4 shadow-sm">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[
          { label: "Deck A", value: deckA, set: setDeckA },
          { label: "Deck B", value: deckB, set: setDeckB },
        ].map(({ label, value, set }) => (
          <div key={label}>
            <label className="mb-1 block text-xs font-semibold text-text-primary">{label}</label>
            <textarea
              value={value}
              onChange={(e) => set(e.target.value)}
              rows={6}
              placeholder={"Pokémon: 12\n4 Miraidon ex SVI 81\n…"}
              className="w-full resize-y rounded-lg border border-black/15 bg-white p-2 font-mono text-[11px] text-text-primary"
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <select
          value={n}
          onChange={(e) => setN(Number(e.target.value))}
          className="rounded-lg border border-black/15 bg-white px-2 py-1.5 text-xs text-text-primary"
        >
          {N_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o} games
            </option>
          ))}
        </select>
        <button
          onClick={run}
          disabled={loading || !deckA.trim() || !deckB.trim()}
          className="rounded-lg border border-transparent bg-black px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {loading ? "Simulating…" : "Simulate"}
        </button>
        {data && (
          <span className="text-[10px] text-text-muted">
            {data.cached ? "cached" : `${data.sim.elapsed_ms}ms`} · sim v{data.sim.sim_version} ·
            seed {data.sim.seed}
          </span>
        )}
      </div>

      {error && <p className="mt-3 text-xs text-red-700">{error}</p>}

      {data && (
        <div className="mt-4 flex flex-col gap-3">
          <div>
            <div className="mb-1 flex justify-between text-xs font-semibold text-text-primary">
              <span>{data.archetype_a ?? "Deck A"}</span>
              <span>{data.archetype_b ?? "Deck B"}</span>
            </div>
            <div className="flex h-4 w-full overflow-hidden rounded-full bg-surface">
              <div className="bg-accent" style={{ width: pct(data.sim.win_rate_a) }} />
              {data.sim.draws > 0 && (
                <div
                  className="bg-black/20"
                  style={{ width: pct(data.sim.draws / data.sim.n) }}
                />
              )}
              <div className="flex-1 bg-black/60" />
            </div>
            <div className="mt-1 flex justify-between text-xs text-text-secondary">
              <span>
                {pct(data.sim.win_rate_a)} ({data.sim.wins_a}W)
              </span>
              {data.sim.draws > 0 && <span>{data.sim.draws} draws</span>}
              <span>
                {pct(data.sim.wins_b / data.sim.n)} ({data.sim.wins_b}W)
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
            <span>avg prize diff {data.sim.avg_prize_diff_a >= 0 ? "+" : ""}{data.sim.avg_prize_diff_a.toFixed(1)}</span>
            <span>avg length {data.sim.avg_turns.toFixed(1)} turns</span>
            {data.sim.avg_first_ko_turn !== null && (
              <span>first KO ~turn {data.sim.avg_first_ko_turn.toFixed(1)}</span>
            )}
            {Object.entries(data.sim.end_reasons).map(([reason, count]) => (
              <span key={reason} className="text-text-muted">
                {reason}: {count}
              </span>
            ))}
          </div>

          {data.prior && (
            <p className="text-xs text-text-muted">
              Archetype prior ({data.prior.model_version}): {pct(data.prior.p_a_wins)} for{" "}
              {data.prior.archetype_a ?? "Deck A"} — from historical winrates{" "}
              {pct(data.prior.prior_a)} vs {pct(data.prior.prior_b)}.
            </p>
          )}
          {(data.sim.deck_a.unknown_cards.length > 0 || data.sim.deck_b.unknown_cards.length > 0) && (
            <p className="text-xs text-yellow-700">
              Unresolved cards (played as inert):{" "}
              {[...data.sim.deck_a.unknown_cards, ...data.sim.deck_b.unknown_cards].join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
