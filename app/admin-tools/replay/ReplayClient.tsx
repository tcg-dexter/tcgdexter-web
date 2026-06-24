"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import BattleLogDetail from "@/app/components/BattleLogDetail";
import type {
  ReplayFrame,
  ReplayPayload,
} from "@/app/api/admin/replay/[matchId]/route";
import {
  MAT_STYLES,
  TEXTURES,
  MAT_PADDING,
  MAT_ASPECT,
} from "@/app/admin-tools/deck-mat/DeckMatClient";

// Fires synchronously before first paint on the client (prevents card-width
// overflow flash) and falls back to useEffect during SSR to avoid the
// "useLayoutEffect does nothing on the server" hydration warning.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Hardcoded default mat style for the replay board.
const REPLAY_GRADIENT = MAT_STYLES.find((s) => s.key === "fire-lightning")!.gradient;
const REPLAY_TEXTURE = TEXTURES.find((t) => t.key === "lines")!;

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

  // Auto-pin the thread to its newest post as the playhead advances or
  // rewinds. We scroll on every actionIndex change so the most-recently
  // revealed row stays visible without the user having to scroll.
  const threadScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = threadScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [frame?.actionIndex, selectedId]);

  // Pin the thread aside to the board's measured height so it scrolls
  // inside a fixed envelope instead of stretching the row to fit its own
  // content (which would otherwise push the navigator away from the
  // board on desktop).
  const boardRef = useRef<HTMLDivElement>(null);
  const [boardHeight, setBoardHeight] = useState<number | null>(null);
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    setBoardHeight(el.getBoundingClientRect().height);
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setBoardHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [frame?.actionIndex, selectedId]);

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

        {/* Desktop header (above the thread + board row): match name
            on the left, wordmark in the center, the four stepper
            controls on the right. Replaces the lower TurnNavigator on
            lg+; mobile keeps the navigator below the board. */}
        <ReplayHeader
          playerPrimaryName={data?.playerPrimaryName ?? null}
          opponentPrimaryName={data?.opponentPrimaryName ?? null}
          canStepBack={canStepBack}
          canStepForward={canStepForward}
          canTurnBack={canTurnBack}
          canTurnForward={canTurnForward}
          onStepBack={() => canStepBack && setFrameIndex((i) => i - 1)}
          onStepForward={() => canStepForward && setFrameIndex((i) => i + 1)}
          onTurnBack={stepTurnBack}
          onTurnForward={stepTurnForward}
        />

        {/* Row 1: thread (lg only) + board side-by-side. The aside is
            pinned to the board's measured height so its inner scroll
            container has something to clip against — without this the
            thread would stretch the row taller than the board, pushing
            the navigator out of arm's reach. */}
        <div className="lg:flex lg:items-start lg:gap-6">
          {selectedId && (
            <aside
              key={selectedId}
              className="hidden min-w-0 lg:flex lg:flex-1 lg:flex-col lg:overflow-hidden"
              style={
                boardHeight != null
                  ? { height: `${boardHeight}px`, marginTop: "1rem" }
                  : undefined
              }
            >
              <div
                ref={threadScrollRef}
                className="h-full overflow-y-auto pr-1"
              >
                <BattleLogDetail
                  matchId={selectedId}
                  apiUrl={`/api/admin/replay/${selectedId}/log`}
                  maxSequence={frame?.actionIndex ?? -1}
                  hideScoreCards
                  compactAvatars
                />
              </div>
            </aside>
          )}
          <div ref={boardRef} className="lg:w-[720px] lg:shrink-0">
            <Board frame={frame} loading={loading} error={error} />
          </div>
        </div>

        {/* Row 2: navigator (mobile only — desktop uses the header above)
            + match selector pinned under the board column on desktop,
            full-width on mobile. */}
        <div className="lg:ml-auto lg:w-[720px]">
          <div className="lg:hidden">
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
          </div>

          <MatchSelector
            options={options}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>
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
  canStepBack,
  canStepForward,
  canTurnBack,
  canTurnForward,
  onStepBack,
  onStepForward,
  onTurnBack,
  onTurnForward,
}: {
  playerPrimaryName: string | null;
  opponentPrimaryName: string | null;
  canStepBack: boolean;
  canStepForward: boolean;
  canTurnBack: boolean;
  canTurnForward: boolean;
  onStepBack: () => void;
  onStepForward: () => void;
  onTurnBack: () => void;
  onTurnForward: () => void;
}) {
  const left = playerPrimaryName ?? "?";
  const right = opponentPrimaryName ?? "?";
  const buttonClass =
    "rounded-md border border-black/10 px-2.5 py-1 text-xs font-semibold text-text-secondary hover:bg-surface disabled:opacity-30";
  return (
    <div className="mt-4 hidden items-center gap-4 lg:flex">
      <div className="flex flex-1 min-w-0 items-baseline gap-1.5 text-sm font-semibold text-text-primary">
        <span className="truncate">{left}</span>
        <span className="text-xs font-normal text-text-muted">vs</span>
        <span className="truncate">{right}</span>
      </div>
      <div className="flex shrink-0 justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-wordmark.png"
          alt="TCG Dexter"
          className="h-7 w-auto opacity-90"
        />
      </div>
      <div className="flex flex-1 items-center justify-end gap-1">
        <button
          type="button"
          onClick={onTurnBack}
          disabled={!canTurnBack}
          aria-label="Previous turn"
          title="Previous turn"
          className={buttonClass}
        >
          ⟪
        </button>
        <button
          type="button"
          onClick={onStepBack}
          disabled={!canStepBack}
          aria-label="Previous action"
          title="Previous action"
          className={buttonClass}
        >
          ‹
        </button>
        <button
          type="button"
          onClick={onStepForward}
          disabled={!canStepForward}
          aria-label="Next action"
          title="Next action"
          className={buttonClass}
        >
          ›
        </button>
        <button
          type="button"
          onClick={onTurnForward}
          disabled={!canTurnForward}
          aria-label="Next turn"
          title="Next turn"
          className={buttonClass}
        >
          ⟫
        </button>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────── */
/* Board                                                            */
/* ──────────────────────────────────────────────────────────────── */

// Each mat has bench + active = 2 card rows. 4 fixed-width columns flank the
// center (left-rail, played-card, center, right-rail — or mirrored for P2),
// so 3 fixed card columns + 3 sm+ column gaps constrain the center width.
// Height constraint: 2 card rows + gap must fit inside the mat.
function computeReplayCardWidth(matWidth: number): number {
  const innerW = matWidth - 2 * MAT_PADDING;
  const innerH = matWidth * MAT_ASPECT - 2 * MAT_PADDING;
  const ROW_GAP = 6;
  const maxCardH = (innerH - ROW_GAP) / 2;
  const maxWidthFromH = maxCardH * (245 / 342);
  // 3 fixed cols + center 1fr → 3 outer gaps. 5 bench × conservative gaps.
  const maxWidthFromW = (innerW - 3 * 12 - 5 * 8) / 8;
  return Math.max(20, Math.floor(Math.min(maxWidthFromH, maxWidthFromW)));
}

function Board({
  frame,
  loading,
  error,
}: {
  frame: ReplayFrame | null;
  loading: boolean;
  error: string | null;
}) {
  const matContainerRef = useRef<HTMLDivElement>(null);
  const [matWidth, setMatWidth] = useState(300);

  useIsomorphicLayoutEffect(() => {
    const el = matContainerRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setMatWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cardWidth = computeReplayCardWidth(matWidth);

  return (
    <div ref={matContainerRef} className="mt-4">
      {error ? (
        <div className="rounded-2xl border border-accent/40 bg-white p-6 text-sm text-accent">
          {error}
        </div>
      ) : !frame ? (
        <div className="rounded-2xl border border-black/8 bg-white p-10 text-center text-sm text-text-secondary">
          {loading ? "Loading replay…" : "Pick a match below to begin."}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <PlayerMat
            side="player"
            bench={frame.player.bench}
            active={frame.player.active}
            discardCount={frame.player.discardCount}
            discardTop={frame.player.discardTop}
            discardTopImageUrl={frame.player.discardTopImageUrl}
            deckCount={frame.player.deckCount}
            handCount={frame.player.handCount}
            prizesRemaining={frame.player.prizesRemaining}
            stadium={frame.stadium?.owner === "player" ? frame.stadium : null}
            lastPlayedTrainer={
              frame.lastPlayedTrainer?.actor === "player"
                ? frame.lastPlayedTrainer
                : null
            }
            cardWidth={cardWidth}
            matWidth={matWidth}
          />
          <PlayerMat
            side="opponent"
            bench={frame.opponent.bench}
            active={frame.opponent.active}
            discardCount={frame.opponent.discardCount}
            discardTop={frame.opponent.discardTop}
            discardTopImageUrl={frame.opponent.discardTopImageUrl}
            deckCount={frame.opponent.deckCount}
            handCount={frame.opponent.handCount}
            prizesRemaining={frame.opponent.prizesRemaining}
            stadium={frame.stadium?.owner === "opponent" ? frame.stadium : null}
            lastPlayedTrainer={
              frame.lastPlayedTrainer?.actor === "opponent"
                ? frame.lastPlayedTrainer
                : null
            }
            cardWidth={cardWidth}
            matWidth={matWidth}
          />
        </div>
      )}
    </div>
  );
}

// P1 mat: bench at top, active at bottom — actives face each other across the
// gap between the two mats. P2 mat: active at top, bench at bottom.
//
// 4-column grid per mat:
//   P1: [discard+draw] [played-card] [center] [prize]
//   P2: [prize] [center] [played-card] [draw+discard]
//
// The played-card column is always reserved; it shows the last played
// item/supporter and is empty otherwise (no layout shift between frames).
// The active row uses a 3-sub-column sub-grid so the active card stays
// horizontally centered, with the stadium anchored to one side.
function PlayerMat({
  side,
  bench,
  active,
  discardCount,
  discardTop,
  discardTopImageUrl,
  deckCount,
  handCount,
  prizesRemaining,
  stadium,
  lastPlayedTrainer,
  cardWidth,
  matWidth,
}: {
  side: "player" | "opponent";
  bench: PokemonFrame[];
  active: PokemonFrame | null;
  discardCount: number;
  discardTop?: string | null;
  discardTopImageUrl?: string | null;
  deckCount: number;
  handCount: number;
  prizesRemaining: number;
  stadium: { name: string; imageUrl: string | null } | null;
  lastPlayedTrainer: { name: string; imageUrl: string | null } | null;
  cardWidth: number;
  matWidth: number;
}) {
  const isPlayer = side === "player";
  const label = isPlayer ? "P1" : "P2";
  const texScale = matWidth > 0 ? matWidth / 600 : 1;

  const benchRow = <BenchRow pokemon={bench} cardWidth={cardWidth} />;

  // Active card is always centered. Stadium is anchored left (P1) or right (P2)
  // via a 3-sub-column sub-grid: [left-slot | flex-center active | right-slot].
  const activeRow = (
    <div
      className="grid items-center gap-1.5 sm:gap-3"
      style={{ gridTemplateColumns: `${cardWidth}px 1fr ${cardWidth}px` }}
    >
      <div className="flex justify-center">
        {isPlayer && stadium ? (
          <StadiumSlot label="Stadium" stadium={stadium} cardWidth={cardWidth} />
        ) : null}
      </div>
      <div className="flex justify-center">
        <PokemonSlot label={`${label} Active`} pokemon={active} cardWidth={cardWidth} />
      </div>
      <div className="flex justify-center">
        {!isPlayer && stadium ? (
          <StadiumSlot label="Stadium" stadium={stadium} cardWidth={cardWidth} />
        ) : null}
      </div>
    </div>
  );

  // Played-card column: vertically centered so it sits at the midpoint between
  // the draw and discard piles in the adjacent rail column.
  const playedCardCol = (
    <div className="flex h-full flex-col items-center justify-center">
      {lastPlayedTrainer && (
        <div
          className="relative w-full overflow-hidden rounded border border-amber-400/80 bg-white"
          style={{ width: cardWidth, aspectRatio: "245 / 342" }}
          title={lastPlayedTrainer.name}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lastPlayedTrainer.imageUrl ?? CARD_BACK_URL}
            alt={lastPlayedTrainer.name}
            className="h-full w-full object-cover"
            onError={(e) => {
              if (e.currentTarget.src !== CARD_BACK_URL)
                e.currentTarget.src = CARD_BACK_URL;
            }}
          />
          {!lastPlayedTrainer.imageUrl && (
            <div className="absolute inset-x-1 top-1 rounded bg-black/60 px-1 py-0.5 text-center text-[9px] font-semibold leading-tight text-white line-clamp-2">
              {lastPlayedTrainer.name}
            </div>
          )}
        </div>
      )}
    </div>
  );

  // P1: discard+draw | played-card | center | prize
  // P2: prize | center | played-card | draw+discard
  const gridCols = isPlayer
    ? `${cardWidth}px ${cardWidth}px 1fr ${cardWidth}px`
    : `${cardWidth}px 1fr ${cardWidth}px ${cardWidth}px`;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        padding: MAT_PADDING,
        height: matWidth > 0 ? matWidth * MAT_ASPECT : undefined,
        backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(REPLAY_TEXTURE.svg)}"), ${REPLAY_GRADIENT}`,
        backgroundSize: `${REPLAY_TEXTURE.w * texScale}px ${REPLAY_TEXTURE.h * texScale}px, auto`,
        boxShadow: "0 4px 4px rgba(0,0,0,0.66)",
      }}
    >
      <div
        className="grid h-full gap-1.5 sm:gap-3"
        style={{ gridTemplateColumns: gridCols }}
      >
        {isPlayer ? (
          <>
            {/* P1 Col 1: discard + draw */}
            <div className="flex flex-col gap-1.5 sm:gap-3">
              <Pile
                label="P1 Discard"
                count={discardCount}
                topName={discardTop}
                topImageUrl={discardTopImageUrl}
              />
              <Pile
                label="P1 Draw"
                count={deckCount}
                hint={`${handCount} in hand`}
                useCardBack
              />
            </div>
            {/* P1 Col 2: played card (right of draw/discard, vertically centered) */}
            {playedCardCol}
            {/* P1 Col 3: center — bench top, active bottom */}
            <div className="flex h-full flex-col justify-between">
              {benchRow}
              {activeRow}
            </div>
            {/* P1 Col 4: prize pile */}
            <div className="flex flex-col">
              <StackedPrizePile label="Prize Pile" count={prizesRemaining} />
            </div>
          </>
        ) : (
          <>
            {/* P2 Col 1: prize pile */}
            <div className="flex flex-col">
              <StackedPrizePile label="Prize Pile" count={prizesRemaining} />
            </div>
            {/* P2 Col 2: center — active top, bench bottom */}
            <div className="flex h-full flex-col justify-between">
              {activeRow}
              {benchRow}
            </div>
            {/* P2 Col 3: played card (left of draw/discard, vertically centered) */}
            {playedCardCol}
            {/* P2 Col 4: draw + discard */}
            <div className="flex flex-col gap-1.5 sm:gap-3">
              <Pile
                label="P2 Draw"
                count={deckCount}
                hint={`${handCount} in hand`}
                useCardBack
              />
              <Pile
                label="P2 Discard"
                count={discardCount}
                topName={discardTop}
                topImageUrl={discardTopImageUrl}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Pile({
  label,
  count,
  topName,
  topImageUrl,
  hint,
  useCardBack,
  className = "",
}: {
  label: string;
  count: number;
  topName?: string | null;
  /** When set, render the top card face-up using this image (discard). */
  topImageUrl?: string | null;
  hint?: string;
  /** Render the standard card-back image as the face. */
  useCardBack?: boolean;
  className?: string;
}) {
  if (useCardBack) {
    return (
      <div className={`flex flex-col items-center ${className}`} title={label}>
        <div
          className="relative w-full overflow-hidden rounded border border-black/12"
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

  // Face-up top-card mode — used by the discard piles. Only the topmost
  // card is rendered; previous discards stay implicit behind it.
  if (topName) {
    return (
      <div className={`flex flex-col items-center ${className}`} title={label}>
        <div
          className="relative w-full overflow-hidden rounded border border-black/12 bg-white"
          style={{ aspectRatio: "245 / 342" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={topImageUrl ?? CARD_BACK_URL}
            alt={topName}
            className="h-full w-full object-cover"
            onError={(e) => {
              if (e.currentTarget.src !== CARD_BACK_URL) {
                e.currentTarget.src = CARD_BACK_URL;
              }
            }}
          />
          {!topImageUrl && (
            <div className="absolute inset-x-1 top-1 rounded bg-black/60 px-1 py-0.5 text-center text-[9px] font-semibold leading-tight text-white line-clamp-2">
              {topName}
            </div>
          )}
          <div className="absolute inset-x-1 bottom-1 flex items-center justify-center rounded bg-black/70 py-0.5 text-[10px] font-semibold tabular-nums text-white">
            {count}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center ${className}`} title={label}>
      <div
        className="flex w-full flex-col items-center justify-center rounded border border-dashed border-black/15 bg-white text-[10px] text-text-muted"
        style={{ aspectRatio: "245 / 342" }}
      >
        {hint ?? "empty"}
      </div>
    </div>
  );
}

function BenchRow({ pokemon, cardWidth }: { label?: string; pokemon: PokemonFrame[]; cardWidth: number }) {
  if (pokemon.length === 0) {
    return (
      <div className="flex justify-center gap-1 sm:gap-2">
        <div className="shrink-0" style={{ width: cardWidth, aspectRatio: "245 / 342" }} aria-hidden />
      </div>
    );
  }
  return (
    <div className="flex justify-center gap-2">
      {pokemon.map((mon, i) => (
        <div key={i} className="shrink-0" style={{ width: cardWidth }}>
          <PokemonCardImage mon={mon} />
        </div>
      ))}
    </div>
  );
}

function PokemonSlot({
  label,
  pokemon,
  cardWidth,
}: {
  label: string;
  pokemon: PokemonFrame | null;
  cardWidth: number;
}) {
  return (
    <div
      className="flex flex-col items-center"
      style={{ width: cardWidth }}
      title={label}
    >
      {pokemon ? (
        <PokemonCardImage mon={pokemon} />
      ) : (
        <div
          className="flex w-full items-center justify-center rounded border border-dashed border-black/15 bg-white text-[11px] text-text-muted"
          style={{ aspectRatio: "245 / 342" }}
        >
          empty
        </div>
      )}
    </div>
  );
}

// Special-condition styling. Each pill carries a short label and a
// color-matched chip so a glance at the corner of the card tells you
// what's afflicting the Pokémon. Confused uses "¿?" rather than a
// 3-letter abbreviation (per the game's iconography).
const CONDITION_PILL: Record<string, { label: string; cls: string }> = {
  Poisoned: { label: "PSN", cls: "bg-purple-600 text-white" },
  Burned: { label: "BRN", cls: "bg-orange-500 text-white" },
  Confused: { label: "¿?", cls: "bg-yellow-400 text-black" },
  Asleep: { label: "SLP", cls: "bg-sky-500 text-white" },
  Paralyzed: { label: "PAR", cls: "bg-amber-400 text-black" },
};

function ConditionPill({ condition }: { condition: string }) {
  const meta =
    CONDITION_PILL[condition] ?? {
      label: condition.slice(0, 3).toUpperCase(),
      cls: "bg-gray-500 text-white",
    };
  return (
    <span
      className={`rounded-full px-1 py-[1px] text-[8px] font-bold uppercase leading-none shadow-sm ${meta.cls}`}
      title={condition}
    >
      {meta.label}
    </span>
  );
}

function PokemonCardImage({ mon }: { mon: PokemonFrame }) {
  const remainingHp = mon.hp != null ? Math.max(0, mon.hp - mon.damage) : null;
  const hadFallback = !mon.imageUrl;
  return (
    <div
      className="relative w-full overflow-hidden rounded border border-black/10 bg-white"
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
      {mon.energyTypes.length > 0 && (
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
        </div>
      )}
      {mon.conditions.length > 0 && (
        // Conditions render as color-matched pills anchored to the
        // bottom-right corner of the card. flex-col-reverse means the
        // first condition sits at the bottom and each additional pill
        // stacks upward, mirroring how PTCG-Live's stacked status icons
        // read.
        <div className="pointer-events-none absolute bottom-1 right-1 z-10 flex flex-col-reverse items-end gap-0.5">
          {mon.conditions.map((c) => (
            <ConditionPill key={c} condition={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function StadiumSlot({
  label,
  stadium,
  cardWidth,
}: {
  label: string;
  stadium: { name: string; imageUrl: string | null } | null;
  cardWidth: number;
}) {
  if (!stadium) return null;
  return (
    <div
      className="flex flex-col items-center"
      style={{ width: cardWidth }}
      title={label}
    >
      <div
        className="relative w-full overflow-hidden rounded border border-amber-300/70 bg-white"
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
    <div className="flex w-full flex-col items-center" title={label}>
      {layers === 0 ? (
        <div
          className="flex w-full items-center justify-center rounded border border-dashed border-black/15 text-[10px] text-text-muted"
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
                className="absolute left-0 right-0 overflow-hidden rounded-sm border border-black/15 bg-white shadow-sm"
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
