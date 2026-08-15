"use client";

// Board rendering (mats, card holders, piles, inspector) lives in the
// shared BoardKit so the AI-player practice mode renders the exact same
// surface. This file keeps the replay-specific chrome: match selection,
// playback controls, frame stepping, and the battle-log thread.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import BattleLogDetail, { formatActionLabel } from "@/app/components/BattleLogDetail";
import type {
  ReplayFrame,
  ReplayPayload,
} from "@/app/api/admin/replay/[matchId]/route";
import {
  InspectContext,
  PlayerMat,
  ReplayCardInspector,
  computeReplayCardWidth,
  type InspectTarget,
} from "./BoardKit";
import { MAT_ASPECT } from "@/lib/playmat-layout";

// Fires synchronously before first paint on the client (prevents card-width
// overflow flash) and falls back to useEffect during SSR to avoid the
// "useLayoutEffect does nothing on the server" hydration warning.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export interface ReplayMatchOption {
  id: string;
  createdAt: string;
  playerHandle: string | null;
  opponentHandle: string | null;
  opponentArchetype: string | null;
  result: "win" | "loss" | "draw" | null;
  deckName: string;
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
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2 | 4>(1);

  useEffect(() => {
    if (!selectedId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPlaying(false);
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

  // Auto-advance at the selected speed while playing.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setFrameIndex((i) => {
        if (i >= frameCount - 1) return i;
        return i + 1;
      });
    }, Math.round(1000 / speed));
    return () => clearInterval(id);
  }, [playing, frameCount, speed]);

  // Pause automatically when the last frame is reached.
  useEffect(() => {
    if (playing && frameIndex >= frameCount - 1) setPlaying(false);
  }, [playing, frameIndex, frameCount]);

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

  // Passed to BattleLogDetail so it can scroll only this element as the
  // playhead advances, instead of scrollIntoView dragging the whole page.
  const threadScrollRef = useRef<HTMLDivElement>(null);

  // The thread + board row is only laid out side-by-side at lg: — below
  // that the thread is hidden and mats size themselves the old way (full
  // width, content-driven height). Mirrors Tailwind's default lg breakpoint.
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    setIsDesktop(mq.matches);
    const onChange = () => setIsDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Width available to the thread+board row — the budget the whole 16:9
  // rect has to fit into. Board derives its own width from the resulting
  // height budget (rowWidth * 9/16) rather than the other way around, so
  // mats are only ever as large as the 16:9 envelope allows.
  const rowRef = useRef<HTMLDivElement>(null);
  const [rowWidth, setRowWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    setRowWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setRowWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const heightBudget =
    isDesktop && rowWidth != null ? (rowWidth * 9) / 16 : null;

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
          playing={playing}
          speed={speed}
          onTogglePlay={() => setPlaying((p) => !p)}
          onCycleSpeed={() => setSpeed((s) => s === 0.5 ? 1 : s === 1 ? 2 : s === 2 ? 4 : 0.5)}
          onStepBack={() => { setPlaying(false); canStepBack && setFrameIndex((i) => i - 1); }}
          onStepForward={() => { setPlaying(false); canStepForward && setFrameIndex((i) => i + 1); }}
          onTurnBack={() => { setPlaying(false); stepTurnBack(); }}
          onTurnForward={() => { setPlaying(false); stepTurnForward(); }}
        />

        {/* Row 1: thread (lg only) + board side-by-side, together forming
            a 16:9 rect (rowWidth x rowWidth*9/16). The aside is pinned to
            the board's measured height so its inner scroll container has
            something to clip against — without this the thread would
            stretch the row taller than the board, pushing the navigator
            out of arm's reach. */}
        <div ref={rowRef} className="lg:flex lg:items-start lg:gap-6">
          {selectedId && (
            <aside
              key={selectedId}
              className="relative hidden min-w-0 lg:flex lg:flex-1 lg:flex-col lg:overflow-hidden"
              style={
                boardHeight != null
                  ? { height: `${boardHeight}px`, marginTop: "1rem" }
                  : undefined
              }
            >
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-12 bg-gradient-to-b from-[#f2f2f2] to-[#f2f2f2]/0" />
              <div
                ref={threadScrollRef}
                className="h-full overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                style={boardHeight != null ? { paddingBottom: boardHeight / 2 } : undefined}
              >
                <BattleLogDetail
                  matchId={selectedId}
                  apiUrl={`/api/admin/replay/${selectedId}/log`}
                  maxSequence={frame?.actionIndex ?? -1}
                  hideScoreCards
                  compactAvatars
                  scrollContainerRef={threadScrollRef}
                />
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-12 bg-gradient-to-t from-[#f2f2f2] to-[#f2f2f2]/0" />
            </aside>
          )}
          <div ref={boardRef} className="lg:shrink-0">
            <Board frame={frame} loading={loading} error={error} heightBudget={heightBudget} />
          </div>
        </div>

        {/* Row 2: navigator (mobile only — desktop uses the header above)
            + match selector pinned under the board column on desktop,
            full-width on mobile. */}
        <div className="lg:ml-auto lg:w-[720px]">
          <div className="lg:hidden">
            <TurnNavigator
              frameIndex={frameIndex}
              frameCount={frameCount}
              canStepBack={canStepBack}
              canStepForward={canStepForward}
              canTurnBack={canTurnBack}
              canTurnForward={canTurnForward}
              playing={playing}
              speed={speed}
              onTogglePlay={() => setPlaying((p) => !p)}
              onCycleSpeed={() => setSpeed((s) => s === 0.5 ? 1 : s === 1 ? 2 : s === 2 ? 4 : 0.5)}
              onStepBack={() => { setPlaying(false); canStepBack && setFrameIndex((i) => i - 1); }}
              onStepForward={() => { setPlaying(false); canStepForward && setFrameIndex((i) => i + 1); }}
              onTurnBack={() => { setPlaying(false); stepTurnBack(); }}
              onTurnForward={() => { setPlaying(false); stepTurnForward(); }}
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

function PlayPauseIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden>
      <path d="M5 3l14 9-14 9V3z" />
    </svg>
  );
}

function speedLabel(s: 0.5 | 1 | 2 | 4): string {
  return s === 0.5 ? "½×" : `${s}×`;
}

function ReplayHeader({
  playerPrimaryName,
  opponentPrimaryName,
  canStepBack,
  canStepForward,
  canTurnBack,
  canTurnForward,
  playing,
  speed,
  onTogglePlay,
  onCycleSpeed,
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
  playing: boolean;
  speed: 0.5 | 1 | 2 | 4;
  onTogglePlay: () => void;
  onCycleSpeed: () => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onTurnBack: () => void;
  onTurnForward: () => void;
}) {
  const left = playerPrimaryName ?? "?";
  const right = opponentPrimaryName ?? "?";
  const buttonClass =
    "rounded-md border border-black/10 px-4 py-1.5 text-sm font-semibold text-text-secondary hover:bg-surface disabled:opacity-30";
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
          src="/logo-wordmark.png"
          alt="TCG Dexter"
          className="h-[42px] w-auto opacity-90"
        />
      </div>
      <div className="flex flex-1 items-center justify-end gap-1.5">
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
          onClick={onTogglePlay}
          disabled={!playing && !canStepForward}
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause" : "Play"}
          className={`${buttonClass} px-3`}
        >
          <PlayPauseIcon playing={playing} />
        </button>
        <button
          type="button"
          onClick={onCycleSpeed}
          aria-label={`Playback speed: ${speedLabel(speed)}`}
          title="Cycle playback speed"
          className="rounded-md border border-black/10 px-2.5 py-1.5 text-xs font-semibold tabular-nums text-text-secondary hover:bg-surface"
        >
          {speedLabel(speed)}
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

// Fixed vertical chrome inside the mat column besides the two mats
// themselves: Board's own mt-4 (16px) + two gap-3 row gaps (12px each,
// mat-to-bar and bar-to-mat) + BetweenMatsBar's height. The bar is a
// text-sm label row (20px) + a fixed 2.5rem/40px two-line action row
// (see the `h-[2.5rem]` on its second row below) = 62px, so the whole
// bar never varies and this can stay a plain constant instead of
// something measured live (which risked feeding back into its own
// width — the bar sits inside the very column this constant sizes).
const BOARD_VERTICAL_CHROME_PX = 16 + 2 * 12 + 62;

function Board({
  frame,
  loading,
  error,
  heightBudget,
}: {
  frame: ReplayFrame | null;
  loading: boolean;
  error: string | null;
  /** When set (desktop, thread+board forming a 16:9 rect), the mat width
   *  is derived from this height budget instead of measured from an
   *  ambient container width — see BOARD_VERTICAL_CHROME_PX. Null falls
   *  back to the original measure-the-container behavior (mobile). */
  heightBudget: number | null;
}) {
  const matContainerRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState(300);

  useIsomorphicLayoutEffect(() => {
    if (heightBudget != null) return;
    const el = matContainerRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setMeasuredWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [heightBudget]);

  const matWidth =
    heightBudget != null
      ? Math.max(20, (heightBudget - BOARD_VERTICAL_CHROME_PX) / (2 * MAT_ASPECT))
      : measuredWidth;

  const cardWidth = computeReplayCardWidth(matWidth);
  const [inspect, setInspect] = useState<InspectTarget | null>(null);

  return (
    <InspectContext.Provider value={setInspect}>
    <div
      ref={matContainerRef}
      className="mt-4"
      style={heightBudget != null ? { width: matWidth } : undefined}
    >
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
          <BetweenMatsBar frame={frame} />
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
      {inspect && (
        <ReplayCardInspector target={inspect} onClose={() => setInspect(null)} />
      )}
    </div>
    </InspectContext.Provider>
  );
}

// Thread-style current-action strip slotted between the two mats. Repurposes
// the battle-log thread's vocabulary — actor name + concise action + a
// black "Turn N" pill — but collapses to a single row showing only the
// action for the board state on screen. Left: actor (or "Setup" / "Pokémon
// Checkup" for the synthetic phases). Center: the current action. Right: the
// turn number.
function BetweenMatsBar({ frame }: { frame: ReplayFrame }) {
  const leftLabel =
    frame.phase === "setup"
      ? "Setup"
      : frame.phase === "checkup"
        ? "Pokémon Checkup"
        : frame.actor === "player"
          ? frame.player.handle ?? "Player"
          : frame.actor === "opponent"
            ? frame.opponent.handle ?? "Opponent"
            : "Game";
  // Setup has no turn yet; turns and between-turn checkups do.
  const showTurn = frame.phase === "turn" || frame.phase === "checkup";

  // Turn bookends ("… ended their turn", "<player>'s turn") are implied by
  // whatever action follows, so we suppress them here and leave the action
  // line blank rather than echoing redundant scaffolding.
  const summary = frame.summary ?? "";
  const s = summary.toLowerCase();
  const handles = [frame.player.handle, frame.opponent.handle]
    .filter((h): h is string => Boolean(h))
    .map((h) => h.toLowerCase());
  const isImplied =
    s.includes("ended their turn") ||
    handles.some((h) => s.includes(`${h}'s turn`) || s.includes(`${h} turn`));
  // During a player's turn the holder is named on the line above, so strip a
  // leading "<holder> " / "<holder>'s " from the action (and recapitalize).
  // Setup/checkup keep the name since the left label doesn't identify who acted.
  const turnHolder =
    frame.phase === "turn"
      ? frame.actor === "player"
        ? frame.player.handle
        : frame.actor === "opponent"
          ? frame.opponent.handle
          : null
      : null;
  // "Opponent" in the action means the side opposite the actor.
  const otherName =
    frame.actor === "player"
      ? frame.opponent.handle
      : frame.actor === "opponent"
        ? frame.player.handle
        : null;
  const actionText = isImplied
    ? ""
    : formatActionLabel(summary, { authorName: turnHolder, otherName });

  return (
    <div className="flex flex-col gap-0.5 px-1">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-bold text-text-primary">
          {leftLabel}
        </span>
        {showTurn && (
          <span className="shrink-0 rounded-full bg-[#1a1a1a] px-2.5 py-0.5 text-[10px] font-bold tabular-nums text-white">
            Turn {frame.turn}
          </span>
        )}
      </div>
      <div className="line-clamp-2 h-[2.5rem] overflow-hidden py-1 text-center text-xs leading-snug text-text-secondary">
        {actionText}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────── */
/* Turn navigator                                                   */
/* ──────────────────────────────────────────────────────────────── */

function TurnNavigator({
  frameIndex,
  frameCount,
  canStepBack,
  canStepForward,
  canTurnBack,
  canTurnForward,
  playing,
  speed,
  onTogglePlay,
  onCycleSpeed,
  onStepBack,
  onStepForward,
  onTurnBack,
  onTurnForward,
}: {
  frameIndex: number;
  frameCount: number;
  canStepBack: boolean;
  canStepForward: boolean;
  canTurnBack: boolean;
  canTurnForward: boolean;
  playing: boolean;
  speed: 0.5 | 1 | 2 | 4;
  onTogglePlay: () => void;
  onCycleSpeed: () => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onTurnBack: () => void;
  onTurnForward: () => void;
}) {
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
          <div className="text-[10px] tabular-nums text-text-muted">
            Step {frameCount > 0 ? frameIndex + 1 : 0} / {frameCount}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={onTogglePlay}
              disabled={!playing && !canStepForward}
              aria-label={playing ? "Pause" : "Play"}
              title={playing ? "Pause" : "Play"}
              className="rounded-md border border-black/10 px-3 py-1.5 text-text-secondary hover:bg-surface disabled:opacity-30"
            >
              <PlayPauseIcon playing={playing} />
            </button>
            <button
              type="button"
              onClick={onCycleSpeed}
              aria-label={`Playback speed: ${speedLabel(speed)}`}
              title="Cycle playback speed"
              className="rounded-md border border-black/10 px-2.5 py-1.5 text-xs font-semibold tabular-nums text-text-secondary hover:bg-surface"
            >
              {speedLabel(speed)}
            </button>
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
