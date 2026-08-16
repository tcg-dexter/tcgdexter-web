"use client";

// Board rendering (mats, card holders, piles, inspector) lives in the
// shared BoardKit so the AI-player practice mode renders the exact same
// surface. This file keeps the replay-specific chrome: match selection,
// playback controls, frame stepping, and the battle-log thread.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
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
  // True when the pending frame change is a *jump* (scrub, turn skip, match
  // load) rather than a single step. Board/bench layout animations model a
  // card physically moving between slots, which is only meaningful one
  // action at a time — across a jump they animate cards along routes the
  // game never took, and a fast drag leaves them mid-flight. Jumps therefore
  // cut straight to the destination state.
  const [instant, setInstant] = useState(false);

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
        setInstant(true);
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
  // Turn numbers are monotonic (0 = setup, then 1, 2, 3… per lib/engine/sim's
  // state.turn.number), so the last frame's is the match's turn total.
  const totalTurns =
    data && data.frames.length > 0 ? data.frames[data.frames.length - 1].turn : 0;

  // Auto-advance at the selected speed while playing.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setInstant(false);
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

        {/* Desktop header (above the thread + board row): match name on
            the left, wordmark centered. Playback controls live in the
            dedicated module below the row instead (all breakpoints). */}
        <ReplayHeader
          playerPrimaryName={data?.playerPrimaryName ?? null}
          opponentPrimaryName={data?.opponentPrimaryName ?? null}
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
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-12 bg-gradient-to-b from-[var(--bg)] to-transparent" />
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
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-12 bg-gradient-to-t from-[var(--bg)] to-transparent" />
            </aside>
          )}
          <div ref={boardRef} className="lg:shrink-0">
            <Board frame={frame} loading={loading} error={error} heightBudget={heightBudget} instant={instant} />
          </div>
        </div>

        {/* Playback module: transport controls + scrubbable timeline,
            spanning the full thread+board row above (not just the mat
            column) so it reads as one wide player bar underneath the
            whole 16:9 viewport, at every breakpoint. */}
        <PlaybackModule
          frameIndex={frameIndex}
          frameCount={frameCount}
          turnStartIndices={turnStartIndices}
          currentTurn={frame?.turn ?? null}
          totalTurns={totalTurns}
          canStepBack={canStepBack}
          canStepForward={canStepForward}
          canTurnBack={canTurnBack}
          canTurnForward={canTurnForward}
          playing={playing}
          speed={speed}
          onTogglePlay={() => setPlaying((p) => !p)}
          onSelectSpeed={(s) => setSpeed(s)}
          onStepBack={() => { setPlaying(false); setInstant(false); canStepBack && setFrameIndex((i) => i - 1); }}
          onStepForward={() => { setPlaying(false); setInstant(false); canStepForward && setFrameIndex((i) => i + 1); }}
          onTurnBack={() => { setPlaying(false); setInstant(true); stepTurnBack(); }}
          onTurnForward={() => { setPlaying(false); setInstant(true); stepTurnForward(); }}
          onScrub={(i) => { setPlaying(false); setInstant(true); setFrameIndex(i); }}
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
  instant,
}: {
  frame: ReplayFrame | null;
  loading: boolean;
  error: string | null;
  /** Skip card layout animations because the playhead jumped rather than
   *  stepped — see the `instant` state in ReplayClient. */
  instant: boolean;
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
            instant={instant}
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
            instant={instant}
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
/* Playback module                                                  */
/* ──────────────────────────────────────────────────────────────── */

// Dedicated transport module below the thread+board row — the scrubbable
// timeline plus the same step/turn/play controls at every breakpoint
// (replaces the old split between ReplayHeader's desktop button cluster
// and the mobile-only TurnNavigator).
function PlaybackModule({
  frameIndex,
  frameCount,
  turnStartIndices,
  currentTurn,
  totalTurns,
  canStepBack,
  canStepForward,
  canTurnBack,
  canTurnForward,
  playing,
  speed,
  onTogglePlay,
  onSelectSpeed,
  onStepBack,
  onStepForward,
  onTurnBack,
  onTurnForward,
  onScrub,
}: {
  frameIndex: number;
  frameCount: number;
  turnStartIndices: number[];
  /** state.turn.number for the current frame — 0 during setup, then 1, 2… */
  currentTurn: number | null;
  totalTurns: number;
  canStepBack: boolean;
  canStepForward: boolean;
  canTurnBack: boolean;
  canTurnForward: boolean;
  playing: boolean;
  speed: 0.5 | 1 | 2 | 4;
  onTogglePlay: () => void;
  onSelectSpeed: (speed: 0.5 | 1 | 2 | 4) => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onTurnBack: () => void;
  onTurnForward: () => void;
  onScrub: (frameIndex: number) => void;
}) {
  const pillClass =
    "inline-flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/10 px-4 py-2 text-xs font-semibold text-text-secondary hover:bg-surface disabled:opacity-30";
  const turnLabel =
    frameCount === 0
      ? "—"
      : currentTurn === 0
        ? "Setup"
        : `Turn ${currentTurn} / ${totalTurns}`;
  return (
    <div className="mt-6 rounded-2xl border border-black/8 dark:border-white/10 bg-white dark:bg-surface-elevated p-4">
      <Scrubber
        frameIndex={frameIndex}
        frameCount={frameCount}
        turnStartIndices={turnStartIndices}
        onScrub={onScrub}
      />

      {/* Action stepping on top, turn stepping below — each row's pair
          spread to the module's edges, with the play/pause + speed +
          turn readout sharing one centered column spanning both rows. */}
      <div className="mt-4 grid grid-cols-[auto_1fr_auto] grid-rows-2 items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={onStepBack}
          disabled={!canStepBack}
          className={`${pillClass} col-start-1 row-start-1 justify-self-start`}
          aria-label="Previous action"
          title="Previous action"
        >
          <span aria-hidden>‹</span> Action
        </button>
        <button
          type="button"
          onClick={onTurnBack}
          disabled={!canTurnBack}
          className={`${pillClass} col-start-1 row-start-2 justify-self-start`}
          aria-label="Previous turn"
          title="Previous turn"
        >
          <span aria-hidden>‹</span> Turn
        </button>

        <div className="col-start-2 row-start-1 row-span-2 flex flex-col items-center gap-1.5">
          <div className="text-[10px] tabular-nums text-text-muted">{turnLabel}</div>
          <button
            type="button"
            onClick={onTogglePlay}
            disabled={!playing && !canStepForward}
            aria-label={playing ? "Pause" : "Play"}
            title={playing ? "Pause" : "Play"}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-black/10 dark:border-white/10 text-text-primary hover:bg-surface disabled:opacity-30"
          >
            <PlayPauseIcon playing={playing} />
          </button>
          <SpeedMenu speed={speed} onSelect={onSelectSpeed} />
        </div>

        <button
          type="button"
          onClick={onStepForward}
          disabled={!canStepForward}
          className={`${pillClass} col-start-3 row-start-1 justify-self-end`}
          aria-label="Next action"
          title="Next action"
        >
          Action <span aria-hidden>›</span>
        </button>
        <button
          type="button"
          onClick={onTurnForward}
          disabled={!canTurnForward}
          className={`${pillClass} col-start-3 row-start-2 justify-self-end`}
          aria-label="Next turn"
          title="Next turn"
        >
          Turn <span aria-hidden>›</span>
        </button>
      </div>
    </div>
  );
}

// Speed control: no button chrome of its own — the current value next to
// an up/down arrows glyph. Clicking it doesn't open a dropdown; it expands
// in place into a horizontal row of every option (framer-motion's layout
// animation grows the shared container to fit), and picking one collapses
// the row back down to just the new value.
const SPEED_OPTIONS: (0.5 | 1 | 2 | 4)[] = [0.5, 1, 2, 4];

function SpeedMenu({
  speed,
  onSelect,
}: {
  speed: 0.5 | 1 | 2 | 4;
  onSelect: (speed: 0.5 | 1 | 2 | 4) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <motion.div
      ref={containerRef}
      layout
      transition={{ duration: 0.22, ease: "easeInOut" }}
      className="flex items-center justify-center overflow-hidden rounded-full"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {open ? (
          <motion.div
            key="options"
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-2.5 px-1"
          >
            {SPEED_OPTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  onSelect(s);
                  setOpen(false);
                }}
                aria-label={`Set playback speed to ${speedLabel(s)}`}
                className={`text-[11px] font-semibold tabular-nums transition-colors ${
                  s === speed ? "text-accent" : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {speedLabel(s)}
              </button>
            ))}
          </motion.div>
        ) : (
          <motion.button
            key="trigger"
            layout
            type="button"
            onClick={() => setOpen(true)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            aria-haspopup="true"
            aria-expanded={open}
            aria-label={`Playback speed: ${speedLabel(speed)}`}
            className="inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums text-text-secondary hover:text-text-primary transition-colors"
          >
            {speedLabel(speed)}
            <ChevronsUpDownIcon className="h-3 w-3" />
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ChevronsUpDownIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M7 15l5 5 5-5M7 9l5-5 5 5" />
    </svg>
  );
}

// Draggable timeline scrubbing straight through replay frames. Dragging,
// clicking, or arrow-keying (all free from the native range input) sets
// frameIndex, the single value both the board (via `frame`) and the
// thread (via BattleLogDetail's maxSequence) already derive from — so
// scrubbing keeps them in sync without any extra wiring. Turn boundaries
// render as tick marks under the track so a turn is easy to aim for.
function Scrubber({
  frameIndex,
  frameCount,
  turnStartIndices,
  onScrub,
}: {
  frameIndex: number;
  frameCount: number;
  turnStartIndices: number[];
  onScrub: (frameIndex: number) => void;
}) {
  const max = Math.max(0, frameCount - 1);
  const clamped = Math.min(frameIndex, max);
  const pct = max > 0 ? (clamped / max) * 100 : 0;
  return (
    <div className="relative py-2">
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={clamped}
        disabled={max === 0}
        onChange={(e) => onScrub(Number(e.target.value))}
        aria-label="Scrub through the replay"
        style={{ background: `linear-gradient(to right, #ffffff ${pct}%, var(--border) ${pct}%)` }}
        className="block h-1.5 w-full cursor-pointer appearance-none rounded-full disabled:cursor-not-allowed
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:-mt-[5px] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-black/20 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow
          [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-black/20 [&::-moz-range-thumb]:bg-white
          [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent"
      />
      {/* Turn boundaries, positioned by frame fraction along the track. */}
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2">
        {turnStartIndices.map((i) => (
          <span
            key={i}
            className="absolute top-0 h-1.5 w-px bg-black/25 dark:bg-white/25"
            style={{ left: `${max > 0 ? (i / max) * 100 : 0}%` }}
          />
        ))}
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
