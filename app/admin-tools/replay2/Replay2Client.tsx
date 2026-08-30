"use client";

// Admin Replay 2.0 tool — a fork of ../replay/ReplayClient. Same chrome
// (battle picker, "{X} vs {Y}" wordmark bar) around the 2.0 viewer.

import { useState } from "react";
import Link from "next/link";
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
        <header className="mb-5 flex items-baseline justify-between gap-3">
          <div>
            <Link
              href="/admin-tools"
              className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted hover:text-text-primary"
            >
              ← Admin Tools
            </Link>
            <h1 className="mt-1 text-2xl font-bold text-text-primary">
              Replay 2.0
            </h1>
            <p className="mt-0.5 text-xs text-text-secondary">
              The replay as a performance — beat-driven motion, FX and camera.
            </p>
          </div>
        </header>

        {selectedId && (
          <ReplayViewer2
            key={selectedId}
            battleId={selectedId}
            replayUrl={`/api/admin/replay2/${selectedId}`}
            // The thread is reused as-is from v1, so it keeps reading the
            // v1 log endpoint. Only the board payload needed a new route,
            // for the beats alongside it.
            logUrl={`/api/admin/replay/${selectedId}/log`}
            renderHeader={(payload) => (
              <ReplayHeader
                playerPrimaryName={payload?.playerPrimaryName ?? null}
                opponentPrimaryName={payload?.opponentPrimaryName ?? null}
              />
            )}
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
/* Desktop header                                                   */
/* ──────────────────────────────────────────────────────────────── */

function ReplayHeader({
  playerPrimaryName,
  opponentPrimaryName,
}: {
  playerPrimaryName: string | null;
  opponentPrimaryName: string | null;
}) {
  const left = playerPrimaryName ?? "?";
  const right = opponentPrimaryName ?? "?";
  return (
    <div className="mt-4 hidden items-center gap-6 lg:flex">
      <div className="flex flex-1 min-w-0 items-baseline gap-2 text-xl font-semibold text-text-primary">
        <span className="truncate">{left}</span>
        <span className="text-base font-normal text-text-muted">vs</span>
        <span className="truncate">{right}</span>
      </div>
      <div className="flex shrink-0 justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-wordmark-light.png"
          alt="TCG Dexter"
          className="h-[42px] w-auto opacity-90 dark:hidden"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-wordmark-dark.png"
          alt="TCG Dexter"
          className="hidden h-[42px] w-auto opacity-90 dark:block"
        />
      </div>
      <div className="flex-1" />
    </div>
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
