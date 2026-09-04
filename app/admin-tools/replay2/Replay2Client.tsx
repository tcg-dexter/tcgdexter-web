"use client";

// Admin Replay 2.0 tool — a fork of ../replay/ReplayClient. Same chrome
// (battle picker, "{X} vs {Y}" wordmark bar) around the 2.0 viewer.

import { useState } from "react";
import ReplayViewer2 from "./ReplayViewer2";

export interface ReplayBattleOption {
  id: string;
  createdAt: string;
  playerHandle: string | null;
  opponentHandle: string | null;
  opponentArchetype: string | null;
  result: "win" | "loss" | "draw" | null;
  deckName: string;
}

interface Replay2ClientProps {
  options: ReplayBattleOption[];
}

export default function Replay2Client({ options }: Replay2ClientProps) {
  const [selectedId, setSelectedId] = useState<string | null>(
    options[0]?.id ?? null,
  );

  return (
    <main className="min-h-dvh bg-bg pb-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-6">
        {/* No header: the page leads with the replay viewer. The matchup and
            a Copy Battle Log capsule are rendered below the module, inside
            ReplayViewer2. */}
        {selectedId && (
          <ReplayViewer2
            key={selectedId}
            battleId={selectedId}
            replayUrl={`/api/admin/replay2/${selectedId}`}
            // The thread is reused as-is from v1, so it keeps reading the
            // v1 log endpoint. Only the board payload needed a new route,
            // for the beats alongside it.
            logUrl={`/api/admin/replay/${selectedId}/log`}
          />
        )}

        <BattleSelector
          options={options}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>
    </main>
  );
}

/* ──────────────────────────────────────────────────────────────── */
/* Battle selector                                                  */
/* ──────────────────────────────────────────────────────────────── */

function BattleSelector({
  options,
  selectedId,
  onSelect,
}: {
  options: ReplayBattleOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="mt-4 rounded-2xl border border-black/8 bg-white p-4">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
        Recent imported battles
      </div>
      {options.length === 0 ? (
        <p className="py-3 text-xs text-text-secondary">
          No battles with battle logs yet.
        </p>
      ) : (
        <ul className="divide-y divide-black/5">
          {options.map((m) => {
            const active = m.id === selectedId;
            const dt = new Date(m.createdAt);
            const dateLabel = dt.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            });
            const resultClass =
              m.result === "win"
                ? "bg-emerald-100 text-emerald-700"
                : m.result === "loss"
                  ? "bg-rose-100 text-rose-700"
                  : "bg-gray-100 text-gray-700";
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onSelect(m.id)}
                  className={`flex w-full items-center justify-between gap-3 px-1 py-2 text-left text-xs transition ${
                    active ? "bg-surface" : "hover:bg-surface/60"
                  }`}
                >
                  <div className="flex flex-1 flex-col">
                    <span className="font-semibold text-text-primary">
                      {m.playerHandle ?? "?"}
                      <span className="mx-1 text-text-muted">vs</span>
                      {m.opponentHandle ?? "?"}
                    </span>
                    <span className="text-[11px] text-text-secondary">
                      {m.deckName}
                      {m.opponentArchetype && (
                        <>
                          <span className="text-text-muted"> · </span>
                          {m.opponentArchetype}
                        </>
                      )}
                    </span>
                  </div>
                  {m.result && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${resultClass}`}
                    >
                      {m.result}
                    </span>
                  )}
                  <span className="w-12 text-right text-[11px] tabular-nums text-text-muted">
                    {dateLabel}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
