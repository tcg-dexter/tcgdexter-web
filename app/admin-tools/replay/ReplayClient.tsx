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
  hp: number | null;
  energy: string[];
  energyTypes: string[];
  conditions: string[];
  evolutionStack: string[];
  imageUrl: string | null;
}

// pokemontcg.io serves the standard Pokémon card-back PNG as the body of
// a 404 — browsers render the bytes regardless of status code. Reusing
// that gives us a card-back without bundling an asset of our own.
const CARD_BACK_URL = "https://images.pokemontcg.io/back.png";

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
    let currentStart = 0;
    for (let i = turnStartIndices.length - 1; i >= 0; i--) {
      if (turnStartIndices[i] <= frameIndex) {
        currentStart = turnStartIndices[i];
        break;
      }
    }
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
    <div className="mt-4 rounded-2xl border border-black/8 bg-white p-4 sm:p-5">
      <div className="grid grid-cols-[64px_1fr_64px] gap-3 sm:grid-cols-[75px_1fr_75px] sm:gap-[14px]">
        {/* ── Left rail: P1 piles at top, P2 prize pile at bottom ─ */}
        <div className="flex flex-col gap-3">
          <Pile
            label="P1 Discard"
            count={frame.player.discardCount}
            topName={frame.player.discardTop}
          />
          <Pile
            label="P1 Draw"
            count={frame.player.deckCount}
            hint={`${frame.player.handCount} in hand`}
            useCardBack
          />
          <div className="flex-1" aria-hidden />
          <StackedPrizePile label="Prize Pile" count={frame.opponent.prizesRemaining} />
        </div>

        {/* ── Center: benches + stadium-flanked actives ─────────
            The middle row is stadium | (P1 active over P2 active) |
            stadium. Only one Stadium ever sits in play; the slot
            opposite the active owner shows an empty placeholder. */}
        <div className="flex flex-col gap-3">
          <BenchRow
            label={`P1 Bench${frame.player.handle ? ` · ${frame.player.handle}` : ""}`}
            pokemon={frame.player.bench}
          />
          <div className="flex items-center justify-center gap-3">
            <StadiumSlot
              label="P1 Stadium"
              stadium={frame.stadium?.owner === "player" ? frame.stadium : null}
            />
            <div className="flex flex-col items-center gap-2">
              <PokemonSlot label="P1 Active" pokemon={frame.player.active} />
              <PokemonSlot label="P2 Active" pokemon={frame.opponent.active} />
            </div>
            <StadiumSlot
              label="P2 Stadium"
              stadium={frame.stadium?.owner === "opponent" ? frame.stadium : null}
            />
          </div>
          <BenchRow
            label={`P2 Bench${frame.opponent.handle ? ` · ${frame.opponent.handle}` : ""}`}
            pokemon={frame.opponent.bench}
          />
        </div>

        {/* ── Right rail: P1 prize pile at top, P2 piles at bottom ─ */}
        <div className="flex flex-col gap-3">
          <StackedPrizePile label="Prize Pile" count={frame.player.prizesRemaining} />
          <div className="flex-1" aria-hidden />
          <Pile
            label="P2 Draw"
            count={frame.opponent.deckCount}
            hint={`${frame.opponent.handCount} in hand`}
            useCardBack
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
  useCardBack,
  className = "",
}: {
  label: string;
  count: number;
  topName?: string | null;
  hint?: string;
  /** Render the standard card-back image as the face. */
  useCardBack?: boolean;
  className?: string;
}) {
  if (useCardBack) {
    return (
      <div className={`flex flex-col items-center gap-1 ${className}`}>
        <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-text-muted leading-tight text-center">
          {label}
        </div>
        <div
          className="relative w-full overflow-hidden rounded-lg border border-black/12"
          style={{ aspectRatio: "245 / 342" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={CARD_BACK_URL}
            alt=""
            aria-hidden
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-x-1 bottom-1 flex items-center justify-center rounded bg-black/70 py-0.5 text-[10px] font-semibold tabular-nums text-white">
            {count}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center gap-1 ${className}`}>
      <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-text-muted leading-tight text-center">
        {label}
      </div>
      <div
        className="flex w-full flex-col items-center justify-between rounded-lg border border-black/12 bg-surface px-1.5 py-2 text-center"
        style={{ aspectRatio: "245 / 342" }}
      >
        <div className="text-2xl font-semibold tabular-nums text-text-primary">
          {count}
        </div>
        <div className="text-[9px] text-text-secondary leading-tight line-clamp-2">
          {topName ?? hint ?? " "}
        </div>
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
      <div className="mt-2 flex justify-center gap-2">
        {Array.from({ length: 5 }).map((_, i) => {
          const mon = pokemon[i];
          // Width-matched to the rail piles (P1/P2 Discard, P1/P2 Draw)
          // so benched Pokémon read at the same scale as the side stacks.
          return (
            <div key={i} className="w-[64px] shrink-0 sm:w-[75px]">
              {mon ? (
                <PokemonCardImage mon={mon} />
              ) : (
                <div
                  className="flex w-full items-center justify-center rounded-lg border border-dashed border-black/15 bg-white text-[10px] text-text-muted"
                  style={{ aspectRatio: "245 / 342" }}
                >
                  empty
                </div>
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
    <div className="flex w-[90px] flex-col items-center gap-1 sm:w-[95px]">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
        {label}
      </div>
      {pokemon ? (
        <PokemonCardImage mon={pokemon} />
      ) : (
        <div
          className="flex w-full items-center justify-center rounded-lg border border-dashed border-black/15 bg-white text-[11px] text-text-muted"
          style={{ aspectRatio: "245 / 342" }}
        >
          empty
        </div>
      )}
    </div>
  );
}

function PokemonCardImage({ mon }: { mon: PokemonFrame }) {
  const remainingHp = mon.hp != null ? Math.max(0, mon.hp - mon.damage) : null;
  const hadFallback = !mon.imageUrl;
  return (
    <div
      className="relative w-full overflow-hidden rounded-lg border border-black/10 bg-white"
      style={{ aspectRatio: "245 / 342" }}
      title={mon.name}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={mon.imageUrl ?? CARD_BACK_URL}
        alt={mon.name}
        className="h-full w-full object-cover"
        onError={(e) => {
          if (e.currentTarget.src !== CARD_BACK_URL) {
            e.currentTarget.src = CARD_BACK_URL;
          }
        }}
      />
      {hadFallback && (
        <div className="absolute inset-x-1 top-1 rounded bg-black/60 px-1 py-0.5 text-center text-[9px] font-semibold leading-tight text-white line-clamp-2">
          {mon.name}
        </div>
      )}
      {remainingHp != null && (
        <span className="absolute right-1 top-1 flex items-baseline gap-0.5 rounded-full bg-black px-1.5 py-[2px] text-white shadow-sm">
          <span className="text-[8px] font-bold uppercase leading-none">HP</span>
          <span className="text-[12px] font-semibold tabular-nums leading-none">
            {remainingHp}
          </span>
        </span>
      )}
      {(mon.energyTypes.length > 0 || mon.conditions.length > 0) && (
        // Gradient footer matches the Card Catalog's CardFooterOverlay so
        // the energy icons sit on the same darkened band shape across the
        // app. Energies render left-to-right in attach order.
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-start gap-[2px] px-1 pb-1 pt-3 bg-gradient-to-b from-transparent to-neutral-800 to-80%">
          {mon.energyTypes.map((t, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={`/types/${t.toLowerCase()}.png`}
              alt={t}
              className="h-3 w-3"
            />
          ))}
          {mon.conditions.map((c) => (
            <span
              key={c}
              className="ml-0.5 rounded bg-violet-500/90 px-1 py-[1px] text-[9px] font-semibold uppercase text-white"
              title={c}
            >
              {c[0]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function StadiumSlot({
  label,
  stadium,
}: {
  label: string;
  stadium: { name: string; imageUrl: string | null } | null;
}) {
  return (
    <div className="flex w-[88px] flex-col items-center gap-1 sm:w-[94px]">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted text-center">
        {label}
      </div>
      {stadium ? (
        <div
          className="relative w-full overflow-hidden rounded-lg border border-amber-300/70 bg-white"
          style={{ aspectRatio: "245 / 342" }}
          title={stadium.name}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={stadium.imageUrl ?? CARD_BACK_URL}
            alt={stadium.name}
            className="h-full w-full object-cover"
            onError={(e) => {
              if (e.currentTarget.src !== CARD_BACK_URL) {
                e.currentTarget.src = CARD_BACK_URL;
              }
            }}
          />
          {!stadium.imageUrl && (
            <div className="absolute inset-x-1 top-1 rounded bg-black/60 px-1 py-0.5 text-center text-[9px] font-semibold leading-tight text-white line-clamp-2">
              {stadium.name}
            </div>
          )}
        </div>
      ) : (
        <div
          className="flex w-full items-center justify-center rounded-lg border border-dashed border-black/15 bg-white text-[10px] text-text-muted text-center px-1"
          style={{ aspectRatio: "245 / 342" }}
        >
          no stadium
        </div>
      )}
    </div>
  );
}

function StackedPrizePile({ label, count }: { label: string; count: number }) {
  // Render up to `count` card backs stacked with a small vertical offset
  // so the prize pile reads as "a stack of cards" without exploding the
  // layout. Each layer is absolutely positioned; the outermost container
  // reserves enough vertical room for the deepest stack.
  const layers = Math.max(0, Math.min(6, count));
  // % of container width per stacked card. Kept tight so the rendered
  // prize pile fits inside its rail column without spilling past the
  // bottom of the board container.
  const OFFSET_PCT_PER_LAYER = 4;
  return (
    <div className="flex w-full flex-col items-center gap-1">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted text-center">
        {label}
      </div>
      {layers === 0 ? (
        <div
          className="flex w-full items-center justify-center rounded-lg border border-dashed border-black/15 text-[10px] text-text-muted"
          style={{ aspectRatio: "245 / 342" }}
        >
          empty
        </div>
      ) : (
        <div
          className="relative w-full"
          style={{
            // Card aspect (342/245 ≈ 1.396) + extra room for the layered cards.
            paddingBottom: `${(342 / 245) * 100 + (layers - 1) * OFFSET_PCT_PER_LAYER}%`,
          }}
        >
          {Array.from({ length: layers }).map((_, i) => {
            const isTop = i === layers - 1;
            return (
              <div
                key={i}
                className="absolute left-0 right-0 overflow-hidden rounded-md border border-black/15 bg-white shadow-sm"
                style={{
                  top: `${i * OFFSET_PCT_PER_LAYER}%`,
                  paddingBottom: `${(342 / 245) * 100}%`,
                  zIndex: i,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={CARD_BACK_URL}
                  alt=""
                  aria-hidden
                  className="absolute inset-0 h-full w-full object-cover"
                />
                {isTop && (
                  <div className="absolute inset-x-1 bottom-1 rounded bg-black/70 py-0.5 text-center text-[10px] font-semibold tabular-nums text-white">
                    {count}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
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
