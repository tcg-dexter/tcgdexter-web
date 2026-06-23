"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  ReplayFrame,
  ReplayPayload,
} from "@/app/api/admin/replay/[matchId]/route";

export interface ReplayMatchOption {
  id: string;
  createdAt: string;
  playerHandle: string | null;
  opponentHandle: string | null;
  opponentArchetype: string | null;
  result: "win" | "loss" | "draw" | null;
  deckName: string;
}

interface PokemonFrame {
  name: string;
  damage: number;
  energy: string[];
  conditions: string[];
  evolutionStack: string[];
}

interface ReplayClientProps {
  options: ReplayMatchOption[];
}

export default function ReplayClient({ options }: ReplayClientProps) {
  const [selectedId, setSelectedId] = useState<string | null>(
    options[0]?.id ?? null,
  );
  const [data, setData] = useState<ReplayPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    if (!selectedId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/replay/${selectedId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Replay failed (${r.status})`);
        return (await r.json()) as ReplayPayload;
      })
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setFrameIndex(0);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Replay failed");
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const frame: ReplayFrame | null = useMemo(() => {
    if (!data) return null;
    return data.frames[Math.min(frameIndex, data.frames.length - 1)] ?? null;
  }, [data, frameIndex]);

  const frameCount = data?.frames.length ?? 0;

  // Index of every frame that opens a new turn (turn number changes vs the
  // prior frame). Drives the outer chevrons — back/forward by whole turn —
  // without scanning the frame array on every click.
  const turnStartIndices = useMemo(() => {
    if (!data) return [] as number[];
    const starts: number[] = [];
    let prevTurn = Number.NaN;
    data.frames.forEach((f, i) => {
      if (f.turn !== prevTurn) {
        starts.push(i);
        prevTurn = f.turn;
      }
    });
    return starts;
  }, [data]);

  const canStepBack = frameIndex > 0;
  const canStepForward = frameIndex < frameCount - 1;

  function stepTurnBack() {
    if (turnStartIndices.length === 0) return;
    // Find the start-of-turn for the current frame, then back up one turn.
    let currentStart = 0;
    for (let i = turnStartIndices.length - 1; i >= 0; i--) {
      if (turnStartIndices[i] <= frameIndex) {
        currentStart = turnStartIndices[i];
        break;
      }
    }
    // If already at the start of a turn, jump to the previous turn's start;
    // otherwise jump to the current turn's start.
    if (frameIndex === currentStart) {
      const idx = turnStartIndices.indexOf(currentStart);
      if (idx > 0) setFrameIndex(turnStartIndices[idx - 1]);
    } else {
      setFrameIndex(currentStart);
    }
  }

  function stepTurnForward() {
    const next = turnStartIndices.find((i) => i > frameIndex);
    if (next != null) setFrameIndex(next);
  }

  const canTurnBack =
    turnStartIndices.length > 0 && frameIndex > turnStartIndices[0];
  const canTurnForward =
    turnStartIndices.some((i) => i > frameIndex);

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
            <h1 className="mt-1 text-2xl font-bold text-text-primary">Replay</h1>
            <p className="mt-0.5 text-xs text-text-secondary">
              Step through a parsed battle log on a board.
            </p>
          </div>
        </header>

        <Board frame={frame} loading={loading} error={error} />

        <TurnNavigator
          frame={frame}
          frameIndex={frameIndex}
          frameCount={frameCount}
          canStepBack={canStepBack}
          canStepForward={canStepForward}
          canTurnBack={canTurnBack}
          canTurnForward={canTurnForward}
          onStepBack={() => canStepBack && setFrameIndex((i) => i - 1)}
          onStepForward={() => canStepForward && setFrameIndex((i) => i + 1)}
          onTurnBack={stepTurnBack}
          onTurnForward={stepTurnForward}
        />

        <MatchSelector
          options={options}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>
    </main>
  );
}

/* ──────────────────────────────────────────────────────────────── */
/* Board                                                            */
/* ──────────────────────────────────────────────────────────────── */

function Board({
  frame,
  loading,
  error,
}: {
  frame: ReplayFrame | null;
  loading: boolean;
  error: string | null;
}) {
  if (error) {
    return (
      <div className="mt-4 rounded-2xl border border-accent/40 bg-white p-6 text-sm text-accent">
        {error}
      </div>
    );
  }
  if (!frame) {
    return (
      <div className="mt-4 rounded-2xl border border-black/8 bg-white p-10 text-center text-sm text-text-secondary">
        {loading ? "Loading replay…" : "Pick a match below to begin."}
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-2xl border border-black/8 bg-white p-4 sm:p-6">
      <div className="grid grid-cols-[64px_1fr_64px] gap-3 sm:grid-cols-[88px_1fr_88px] sm:gap-4">
        {/* ── Left rail: P1 piles at top ─────────────────────── */}
        <div className="flex flex-col gap-3 justify-start">
          <Pile
            label="P1 Discard"
            count={frame.player.discardCount}
            topName={frame.player.discardTop}
          />
          <Pile
            label="P1 Draw"
            count={frame.player.deckCount}
            hint={`${frame.player.handCount} in hand`}
          />
          <Pile
            label="P1 Prizes"
            count={frame.player.prizesRemaining}
            mini
          />
        </div>

        {/* ── Center: bench + active rows ───────────────────── */}
        <div className="flex flex-col gap-3">
          <BenchRow
            label={`P1 Bench${frame.player.handle ? ` · ${frame.player.handle}` : ""}`}
            pokemon={frame.player.bench}
          />
          <PokemonSlot label="P1 Active" pokemon={frame.player.active} />
          {frame.stadium && (
            <div className="self-center rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-900">
              Stadium · {frame.stadium.name}
              <span className="ml-2 text-[10px] font-normal text-amber-700/80">
                {frame.stadium.owner === "player" ? "P1" : "P2"}
              </span>
            </div>
          )}
          <PokemonSlot label="P2 Active" pokemon={frame.opponent.active} />
          <BenchRow
            label={`P2 Bench${frame.opponent.handle ? ` · ${frame.opponent.handle}` : ""}`}
            pokemon={frame.opponent.bench}
          />
        </div>

        {/* ── Right rail: P2 piles at bottom ────────────────── */}
        <div className="flex flex-col gap-3 justify-end">
          <Pile
            label="P2 Prizes"
            count={frame.opponent.prizesRemaining}
            mini
          />
          <Pile
            label="P2 Draw"
            count={frame.opponent.deckCount}
            hint={`${frame.opponent.handCount} in hand`}
          />
          <Pile
            label="P2 Discard"
            count={frame.opponent.discardCount}
            topName={frame.opponent.discardTop}
          />
        </div>
      </div>
    </div>
  );
}

function Pile({
  label,
  count,
  topName,
  hint,
  mini,
}: {
  label: string;
  count: number;
  topName?: string | null;
  hint?: string;
  mini?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-between rounded-xl border border-black/12 bg-surface px-1.5 text-center ${
        mini ? "py-1.5" : "py-2"
      }`}
      style={{ aspectRatio: mini ? "16/9" : "3/4" }}
    >
      <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-text-muted leading-tight">
        {label}
      </div>
      <div className={`font-semibold tabular-nums text-text-primary ${mini ? "text-sm" : "text-2xl"}`}>
        {count}
      </div>
      <div className="text-[9px] text-text-secondary leading-tight line-clamp-2">
        {topName ?? hint ?? " "}
      </div>
    </div>
  );
}

function BenchRow({ label, pokemon }: { label: string; pokemon: PokemonFrame[] }) {
  return (
    <div className="rounded-xl border border-black/12 bg-surface px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
        {label}
      </div>
      <div className="mt-2 grid grid-cols-5 gap-2">
        {Array.from({ length: 5 }).map((_, i) => {
          const mon = pokemon[i];
          return (
            <div
              key={i}
              className="rounded-lg border border-black/10 bg-white px-1.5 py-2 text-center"
              style={{ minHeight: 64 }}
            >
              {mon ? <PokemonCard mon={mon} compact /> : (
                <span className="block pt-3 text-[10px] text-text-muted">empty</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PokemonSlot({
  label,
  pokemon,
}: {
  label: string;
  pokemon: PokemonFrame | null;
}) {
  return (
    <div className="self-center w-full max-w-[220px] rounded-xl border border-black/12 bg-white px-3 py-3 text-center">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
        {label}
      </div>
      <div className="mt-2 min-h-[70px]">
        {pokemon ? <PokemonCard mon={pokemon} /> : (
          <span className="block pt-4 text-[11px] text-text-muted">empty</span>
        )}
      </div>
    </div>
  );
}

function PokemonCard({ mon, compact }: { mon: PokemonFrame; compact?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`font-semibold text-text-primary leading-tight ${
          compact ? "text-[11px]" : "text-sm"
        }`}
      >
        {mon.name}
      </div>
      {mon.evolutionStack.length > 0 && (
        <div className="text-[9px] uppercase tracking-wider text-text-muted">
          ← {mon.evolutionStack.join(" → ")}
        </div>
      )}
      <div className="flex items-center gap-1.5 text-[10px] tabular-nums text-text-secondary">
        {mon.damage > 0 && (
          <span className="rounded bg-accent/12 px-1 py-[1px] font-semibold text-accent">
            {mon.damage}
          </span>
        )}
        {mon.energy.length > 0 && (
          <span className="rounded bg-sky-100 px-1 py-[1px] font-semibold text-sky-700">
            ⚡ {mon.energy.length}
          </span>
        )}
        {mon.conditions.map((c) => (
          <span
            key={c}
            className="rounded bg-violet-100 px-1 py-[1px] text-[9px] font-semibold uppercase text-violet-700"
          >
            {c[0]}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────── */
/* Turn navigator                                                   */
/* ──────────────────────────────────────────────────────────────── */

function TurnNavigator({
  frame,
  frameIndex,
  frameCount,
  canStepBack,
  canStepForward,
  canTurnBack,
  canTurnForward,
  onStepBack,
  onStepForward,
  onTurnBack,
  onTurnForward,
}: {
  frame: ReplayFrame | null;
  frameIndex: number;
  frameCount: number;
  canStepBack: boolean;
  canStepForward: boolean;
  canTurnBack: boolean;
  canTurnForward: boolean;
  onStepBack: () => void;
  onStepForward: () => void;
  onTurnBack: () => void;
  onTurnForward: () => void;
}) {
  const turnLabel = frame
    ? frame.phase === "setup"
      ? "Setup"
      : frame.phase === "checkup"
        ? "Checkup"
        : `Turn ${frame.turn}`
    : "—";
  const actorLabel = frame?.actor === "player" ? "P1" : frame?.actor === "opponent" ? "P2" : "";

  return (
    <div className="mt-4 rounded-2xl border border-black/8 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onTurnBack}
          disabled={!canTurnBack}
          className="rounded-md border border-black/10 px-2.5 py-1 text-xs font-semibold text-text-secondary hover:bg-surface disabled:opacity-30"
          aria-label="Previous turn"
          title="Previous turn"
        >
          ⟪
        </button>
        <button
          type="button"
          onClick={onStepBack}
          disabled={!canStepBack}
          className="rounded-md border border-black/10 px-3 py-1 text-xs font-semibold text-text-secondary hover:bg-surface disabled:opacity-30"
          aria-label="Previous action"
          title="Previous action"
        >
          ‹
        </button>
        <div className="flex flex-1 flex-col items-center text-center">
          <div className="text-lg font-bold text-text-primary tabular-nums">
            {turnLabel}
            {actorLabel && (
              <span className="ml-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                {actorLabel}
              </span>
            )}
          </div>
          <div className="mt-0.5 max-w-prose text-[11px] text-text-secondary line-clamp-2">
            {frame?.summary ?? " "}
          </div>
          <div className="mt-1 text-[10px] tabular-nums text-text-muted">
            Step {frameCount > 0 ? frameIndex + 1 : 0} / {frameCount}
          </div>
        </div>
        <button
          type="button"
          onClick={onStepForward}
          disabled={!canStepForward}
          className="rounded-md border border-black/10 px-3 py-1 text-xs font-semibold text-text-secondary hover:bg-surface disabled:opacity-30"
          aria-label="Next action"
          title="Next action"
        >
          ›
        </button>
        <button
          type="button"
          onClick={onTurnForward}
          disabled={!canTurnForward}
          className="rounded-md border border-black/10 px-2.5 py-1 text-xs font-semibold text-text-secondary hover:bg-surface disabled:opacity-30"
          aria-label="Next turn"
          title="Next turn"
        >
          ⟫
        </button>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────── */
/* Match selector                                                   */
/* ──────────────────────────────────────────────────────────────── */

function MatchSelector({
  options,
  selectedId,
  onSelect,
}: {
  options: ReplayMatchOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="mt-4 rounded-2xl border border-black/8 bg-white p-4">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
        Recent imported matches
      </div>
      {options.length === 0 ? (
        <p className="py-3 text-xs text-text-secondary">
          No matches with battle logs yet.
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
