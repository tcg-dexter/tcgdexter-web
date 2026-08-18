"use client";

// The replay playback viewer: the 16:9 thread + board window and the
// transport module beneath it. Extracted from the admin Replay tool so the
// public battles page renders the same surface — the tool keeps only its
// own chrome (match picker, wordmark header) around this.
//
// Board rendering itself (mats, card holders, piles, inspector) lives in
// BoardKit, shared with the AI-player practice mode.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import BattleLogDetail from "@/app/components/BattleLogDetail";
import type { ReplayFrame, ReplayPayload } from "@/lib/replay/frames";
import {
  InspectContext,
  PlayerMat,
  ReplayCardInspector,
  computeReplayCardWidth,
  type InspectTarget,
} from "@/app/admin-tools/replay/BoardKit";
import { MAT_ASPECT } from "@/lib/playmat-layout";

// Fires synchronously before first paint on the client (prevents card-width
// overflow flash) and falls back to useEffect during SSR to avoid the
// "useLayoutEffect does nothing on the server" hydration warning.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

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

/** Circular arrow, shown in place of the play glyph once the playhead is
 *  parked on the final frame — the press restarts the match rather than
 *  resuming it, so the button says so. */
function ReplayIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </svg>
  );
}

function speedLabel(s: 0.5 | 1 | 2 | 4): string {
  return s === 0.5 ? "½×" : `${s}×`;
}
/* ──────────────────────────────────────────────────────────────── */
/* Board                                                            */
/* ──────────────────────────────────────────────────────────────── */

// Name-tab geometry. Each tab tucks TAB_TUCK_PX under its mat so the mat's
// rounded-xl corner sits on top of it (a folder tab). The tuck has to clear
// the mat's 12px corner radius by a comfortable margin, not just match it:
// at exactly 12px the tab's square top corner landed on the tangent point
// where the mat's curve pulls away, so the corner poked out as a small dark
// nub. Doubling it puts the tab's top edge well inside the mat's straight
// run, where it's covered outright.
const TAB_TUCK_PX = 24;
// Height of the band that shows past the mat, built from the name's line
// box plus deliberate padding rather than stated as one number — that way
// the padding stays visible as a choice, and the line-box term still has
// to track text-xs if the label's type ever changes. The tuck is
// unaffected by both, being covered by the mat either way.
const TAB_LABEL_LINE_PX = 16; // text-xs line-height
const TAB_LABEL_PAD_Y_PX = 2;
const TAB_CONTENT_PX = TAB_LABEL_LINE_PX + 2 * TAB_LABEL_PAD_Y_PX;
const TAB_GAP_PX = 8;

// Fixed vertical chrome inside the mat column besides the two mats
// themselves: Board's own mt-4 (16px) + the visible height of both name
// tabs + the one gap that survives between them. Each tab's negative
// margin swallows both its own tucked padding and the gap at its mat
// seam (see MatTab), so of the column's three gaps only the tab↔tab one
// is left, and each tab contributes just TAB_CONTENT_PX.
// All of it is constant, which is what lets this stay a plain number
// instead of something measured live — the tabs sit inside the very column
// this constant sizes, so measuring them would feed back into their width.
const BOARD_VERTICAL_CHROME_PX = 16 + 2 * TAB_CONTENT_PX + TAB_GAP_PX;

const TOTAL_PRIZES = 6;

/**
 * Prize scorekeeper — one pip per prize card that side started with, filled
 * in as they take them. A taken prize reads as a Poké Ball; an untaken one
 * stays a flat grey.
 *
 * Note this counts prizes *taken by* this side, which is why it's driven by
 * the side's own remaining pile: you draw from your own prizes when you
 * knock out the opposing Pokémon, so a shrinking pile is that player
 * scoring, not being scored on.
 */
function PrizePips({ remaining }: { remaining: number }) {
  const taken = Math.max(0, Math.min(TOTAL_PRIZES, TOTAL_PRIZES - remaining));
  return (
    <span
      className="flex shrink-0 items-center gap-1"
      role="img"
      aria-label={`${taken} of ${TOTAL_PRIZES} prizes taken`}
    >
      {Array.from({ length: TOTAL_PRIZES }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className={`h-2.5 w-2.5 rounded-full transition-colors duration-300 ${
            i < taken ? "border border-black bg-white" : "bg-[#6b6b6b]"
          }`}
          // The filled state is a Poké Ball: a hard red-over-white split at
          // the midline. A background-image gradient (rather than a child
          // element) keeps the pip a single box, so the rounding clips both
          // halves in one go.
          //
          // Both halves are fixed colors in either theme — a Poké Ball that
          // recolored with the theme wouldn't read as one. The outline is
          // what makes that survivable on the white dark-mode tab, where
          // the ball's lower half would otherwise disappear into the
          // background.
          //
          // A whole-pixel `border`, not a fractional inset ring: at 0.5px
          // the stroke is 1.5 device pixels on a 3x screen, which can't be
          // spread evenly around the circle, so it antialiased heavier on
          // some arcs and read as a lopsided, off-centre outline. Border
          // also traces the border-radius concentrically by construction.
          // The 10px footprint is unchanged (border-box), and the gradient
          // still splits on the true midline: background-origin is the
          // padding box, so 50% of the inner 8px lands 1 + 4 = 5px down.
          style={
            i < taken
              ? {
                  backgroundImage:
                    "linear-gradient(180deg, var(--accent) 0 50%, #fff 50% 100%)",
                }
              : undefined
          }
        />
      ))}
    </span>
  );
}

/**
 * Folder-style name tab clipped to a mat's inner edge — the player's handle
 * plus their prize scorekeeper. The top mat's tab hangs below it anchored
 * left; the bottom mat's sits above it anchored right, so the two read as
 * belonging to the mats they touch rather than to the gap between them.
 * Pips sit on the side of the name nearer the board's outer edge in both
 * cases (left of the top name, right of the bottom one).
 */
function MatTab({
  name,
  prizesRemaining,
  edge,
}: {
  name: string;
  prizesRemaining: number;
  /** Which mat edge the tab hangs off: "bottom" tucks up under the mat
   *  above it, "top" tucks down under the mat below it. */
  edge: "bottom" | "top";
}) {
  const hangsBelow = edge === "bottom";
  // The column's flex `gap` lands between every pair of its children —
  // including mat↔tab, where the tab is supposed to overlap the mat, not
  // stand off it. Cancelling the gap here is what makes the tuck actually
  // TAB_TUCK_PX: without it the gap gave back 8px of the tuck, and that
  // strip of tucked padding showed as slack on the mat-facing side of the
  // label. It reads differently on each tab — above the name on the top
  // one, below it on the bottom one — and the top mat's drop shadow falls
  // across its share, which is why the two tabs looked like different
  // heights rather than both looking too tall.
  const tuckMargin = -(TAB_TUCK_PX + TAB_GAP_PX);
  return (
    <div
      // z-0 against the mats' z-10: the tab has to paint *under* the mat for
      // the tuck to read, and DOM order alone would put the top mat's tab
      // (a later sibling) on top of it.
      // The tab inverts with the theme — near-black on light, white on
      // dark. The prize pips deliberately don't invert with it; see
      // PrizePips for how they stay legible against both.
      className={`relative z-0 w-fit max-w-full bg-[#1a1a1a] px-3 text-white dark:bg-white dark:text-[#1a1a1a] ${
        hangsBelow ? "self-start rounded-b-xl" : "self-end rounded-t-xl"
      }`}
      // The tucked strip is expressed as padding rather than as part of a
      // fixed overall height, so the box below is exactly the band that
      // shows past the mat — no arithmetic to keep in sync.
      style={{
        marginTop: hangsBelow ? tuckMargin : undefined,
        paddingTop: hangsBelow ? TAB_TUCK_PX : undefined,
        marginBottom: hangsBelow ? undefined : tuckMargin,
        paddingBottom: hangsBelow ? undefined : TAB_TUCK_PX,
      }}
    >
      {/* The band is the name's line box plus TAB_LABEL_PAD_Y_PX either
          side; the 10px pips centre inside it. Note the name deliberately
          keeps text-xs's default line-height rather than leading-none:
          `truncate` brings overflow:hidden with it, and a line box
          tightened to the font size would clip the descenders on handles
          like "brockling12".

          Pips lead on the top tab and trail on the bottom one. Since the
          tabs anchor to opposite sides — top left, bottom right — that
          puts both scorekeepers on the board's outer edges, flush with
          the mats they belong to, and both names inboard. */}
      <div
        className="flex items-center gap-2"
        style={{ height: TAB_CONTENT_PX }}
      >
        {hangsBelow && <PrizePips remaining={prizesRemaining} />}
        <span className="min-w-0 truncate text-xs font-bold">{name}</span>
        {!hangsBelow && <PrizePips remaining={prizesRemaining} />}
      </div>
    </div>
  );
}

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
   *  stepped — see the `instant` state in ReplayViewer. */
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
        <div className="flex flex-col" style={{ gap: TAB_GAP_PX }}>
          {/* z-10 on the mat wrappers so each mat paints over the tab tucked
              beneath it. The wrappers are plain positioning shells — mat
              geometry stays entirely inside PlayerMat. */}
          <div className="relative z-10">
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
          </div>
          <MatTab
            edge="bottom"
            name={frame.player.handle ?? "Player"}
            prizesRemaining={frame.player.prizesRemaining}
          />
          <MatTab
            edge="top"
            name={frame.opponent.handle ?? "Opponent"}
            prizesRemaining={frame.opponent.prizesRemaining}
          />
          <div className="relative z-10">
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
        </div>
      )}
      {inspect && (
        <ReplayCardInspector target={inspect} onClose={() => setInspect(null)} />
      )}
    </div>
    </InspectContext.Provider>
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
  atEnd,
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
  /** Playhead is parked on the final frame — the play button restarts
   *  from the beginning instead of resuming. */
  atEnd: boolean;
  speed: 0.5 | 1 | 2 | 4;
  onTogglePlay: () => void;
  onSelectSpeed: (speed: 0.5 | 1 | 2 | 4) => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onTurnBack: () => void;
  onTurnForward: () => void;
  onScrub: (frameIndex: number) => void;
}) {
  const turnLabel =
    frameCount === 0
      ? "—"
      : currentTurn === 0
        ? "Setup"
        : `Turn ${currentTurn} / ${totalTurns}`;
  return (
    <div className="mt-6">
      <Scrubber
        frameIndex={frameIndex}
        frameCount={frameCount}
        turnStartIndices={turnStartIndices}
        onScrub={onScrub}
      />

      {/* Three centred lines. The readout and the speed picker each get
          their own, rather than stacking inside the control row's middle
          column: both change width in use — the readout between "Setup"
          and "Turn 13 / 13", the picker every time it expands to its
          options — and while they shared a column with the play button,
          that width fed the row and shoved the capsules in and out. On
          their own lines their width is nobody else's business, so the
          steppers hold a fixed spread. */}
      <div className="mt-4 text-center text-[10px] tabular-nums text-text-muted">
        {turnLabel}
      </div>

      {/* Control row: capsules flank the play button and nothing else lives
          here, so items-center puts them on its midline by construction. */}
      <div className="mt-1.5 flex items-center justify-center gap-3">
        <StepCapsule
          label="Action"
          canBack={canStepBack}
          canForward={canStepForward}
          onBack={onStepBack}
          onForward={onStepForward}
        />

        {/* Enabled whenever there are frames at all — parked on the last
            one it restarts rather than sitting dead, so a finished replay
            can be watched again without reaching for the scrubber. */}
        <button
          type="button"
          onClick={onTogglePlay}
          disabled={frameCount === 0}
          aria-label={playing ? "Pause" : atEnd ? "Replay from the start" : "Play"}
          title={playing ? "Pause" : atEnd ? "Replay from the start" : "Play"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-black/10 dark:border-white/10 text-text-primary hover:bg-surface disabled:opacity-30"
        >
          {!playing && atEnd ? <ReplayIcon /> : <PlayPauseIcon playing={playing} />}
        </button>

        <StepCapsule
          label="Turn"
          canBack={canTurnBack}
          canForward={canTurnForward}
          onBack={onTurnBack}
          onForward={onTurnForward}
        />
      </div>

      <div className="mt-1.5 flex justify-center">
        <SpeedMenu speed={speed} onSelect={onSelectSpeed} />
      </div>
    </div>
  );
}

// Every label a StepCapsule can carry. Each capsule reserves room for all
// of them, so "Turn" and "Action" come out the same width instead of the
// two capsules disagreeing by the difference in their labels.
const STEP_LABELS = ["Action", "Turn"] as const;

// A single stepping unit — "‹ Action ›" / "‹ Turn ›" — as one capsule with
// both directions inside it, rather than a separate pill per direction. The
// label names the unit each press moves by, so the two chevrons and the
// noun read as one control.
function StepCapsule({
  label,
  canBack,
  canForward,
  onBack,
  onForward,
}: {
  label: (typeof STEP_LABELS)[number];
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
}) {
  // Shared with the capsule's own outline so the segment rules read as part
  // of the same frame. The rules live on the chevron buttons rather than as
  // separate elements: the buttons are the tallest children, so their
  // borders span the capsule's full inner height on their own.
  const edge = "border-black/10 dark:border-white/10";
  const arrowClass =
    "self-stretch px-5 py-2 text-text-secondary transition-colors hover:text-text-primary disabled:opacity-30 disabled:hover:text-text-secondary";
  return (
    <div className={`inline-flex shrink-0 items-center rounded-full border ${edge}`}>
      <button
        type="button"
        onClick={onBack}
        disabled={!canBack}
        aria-label={`Previous ${label.toLowerCase()}`}
        title={`Previous ${label.toLowerCase()}`}
        className={`${arrowClass} rounded-l-full border-r ${edge} pl-6`}
      >
        <span aria-hidden>‹</span>
      </button>
      {/* Every label stacked in one grid cell, all but this capsule's own
          hidden. The browser sizes the cell to the widest of them, so both
          capsules match without measuring text or hard-coding a width —
          and it stays true if a label is ever renamed. */}
      <span className="grid select-none px-5 text-xs font-semibold text-text-secondary">
        {STEP_LABELS.map((candidate) => (
          <span
            key={candidate}
            aria-hidden={candidate !== label}
            className={`col-start-1 row-start-1 text-center ${
              candidate === label ? "" : "invisible"
            }`}
          >
            {candidate}
          </span>
        ))}
      </span>
      <button
        type="button"
        onClick={onForward}
        disabled={!canForward}
        aria-label={`Next ${label.toLowerCase()}`}
        title={`Next ${label.toLowerCase()}`}
        className={`${arrowClass} rounded-r-full border-l ${edge} pr-6`}
      >
        <span aria-hidden>›</span>
      </button>
    </div>
  );
}

// Speed control: no chrome and no affordance glyph — just the current
// value. Tapping it doesn't open a dropdown; it expands in place into a
// horizontal row of every option (framer-motion's layout animation grows
// the shared container to fit), and picking one collapses the row back
// down to just the new value. The motion is the affordance.
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
            className="text-[11px] font-semibold tabular-nums text-text-secondary transition-colors hover:text-text-primary"
          >
            {speedLabel(speed)}
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
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
  // The track is painted as its own decorative layer rather than as the
  // input's background. That lets the input stand a full thumb tall, so the
  // thumb centers on its own (margin-top 0) instead of being nudged onto a
  // 6px-tall input by a hand-tuned negative offset — which is what left the
  // puck sitting a few pixels high, since the offset had to guess at the
  // UA's default runnable-track box.
  return (
    <div className="relative py-2">
      {/* Track: progress up to the playhead, then the unplayed remainder. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full"
        style={{
          background: `linear-gradient(to right, var(--text-primary) ${pct}%, var(--border) ${pct}%)`,
        }}
      />
      {/* Turn boundaries, positioned by frame fraction along the track.
          Drawn in the page colour so each reads as a notch cut through the
          track — a tinted tick would disappear against the progress fill,
          which is now the same tone as the text (black in light, white in
          dark) on the played side. */}
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2">
        {turnStartIndices.map((i) => (
          <span
            key={i}
            className="absolute top-0 h-1.5 w-px bg-bg"
            style={{ left: `${max > 0 ? (i / max) * 100 : 0}%` }}
          />
        ))}
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={clamped}
        disabled={max === 0}
        onChange={(e) => onScrub(Number(e.target.value))}
        aria-label="Scrub through the replay"
        className="relative block h-4 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed
          [&::-webkit-slider-runnable-track]:h-4 [&::-webkit-slider-runnable-track]:bg-transparent
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-black/20 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow
          [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-black/20 [&::-moz-range-thumb]:bg-white
          [&::-moz-range-track]:h-4 [&::-moz-range-track]:bg-transparent"
      />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────── */
/* Viewer                                                           */
/* ──────────────────────────────────────────────────────────────── */

interface ReplayViewerProps {
  /** Identifies the match to BattleLogDetail (its fetch/reset key). */
  matchId: string;
  /** GET endpoint returning a ReplayPayload for this match. */
  replayUrl: string;
  /** GET endpoint backing the action thread (BattleLogDetail's apiUrl). */
  logUrl: string;
  /** Rendered above the thread+board row, given the loaded payload. The
   *  admin tool draws its "{X} vs {Y}" + wordmark bar here; the battles
   *  page omits it, since its banner already names the matchup. */
  renderHeader?: (payload: ReplayPayload | null) => ReactNode;
  /** Passed through to the thread for win/loss avatar treatment. */
  result?: "win" | "loss" | "draw" | null;
  playerColor?: string;
  opponentColor?: string;
}

export default function ReplayViewer({
  matchId,
  replayUrl,
  logUrl,
  renderHeader,
  result,
  playerColor,
  opponentColor,
}: ReplayViewerProps) {
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
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPlaying(false);
    fetch(replayUrl)
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
  }, [replayUrl]);

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

  const atEnd = frameCount > 0 && frameIndex >= frameCount - 1;

  // Play/pause, plus restart: pressing play while parked on the last frame
  // rewinds to the start and runs again. Both state updates batch into one
  // render, so the auto-pause effect above sees frameIndex 0 alongside
  // playing=true and doesn't immediately stop it. The rewind is a jump, so
  // it cuts rather than animating cards across the whole match.
  function togglePlay() {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (atEnd) {
      setInstant(true);
      setFrameIndex(0);
    }
    setPlaying(true);
  }

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
  const canTurnForward = turnStartIndices.some((i) => i > frameIndex);

  // Passed to BattleLogDetail so it can scroll only this element as the
  // playhead advances, instead of scrollIntoView dragging the whole page.
  const threadScrollRef = useRef<HTMLDivElement>(null);

  // Which layout to build. Null until matchMedia resolves on the client:
  // the two layouts each mount their own BattleLogDetail, so committing
  // before we know would fetch the thread twice and throw the first copy
  // away. Mirrors Tailwind's default lg breakpoint.
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
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
    isDesktop === true && rowWidth != null ? (rowWidth * 9) / 16 : null;

  // Pin the thread aside to the board's measured height so it scrolls
  // inside a fixed envelope instead of stretching the row to fit its own
  // content (which would otherwise push the controls away from the
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
  }, [frame?.actionIndex, matchId]);

  return (
    <>
      {renderHeader?.(data)}

      {/* Desktop: thread + board side by side, together forming a 16:9
          rect (rowWidth x rowWidth*9/16). The aside is pinned to the
          board's measured height so its inner scroll container has
          something to clip against — without this the thread would
          stretch the row taller than the board, pushing the controls out
          of arm's reach. Mobile drops the aside entirely and puts the
          thread below the controls instead. */}
      <div ref={rowRef} className="lg:flex lg:items-start lg:gap-6">
        {isDesktop === true && (
          <aside
            key={matchId}
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
                matchId={matchId}
                apiUrl={logUrl}
                maxSequence={frame?.actionIndex ?? -1}
                result={result}
                playerColor={playerColor}
                opponentColor={opponentColor}
                hideScoreCards
                compactAvatars
                scrollContainerRef={threadScrollRef}
              />
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-12 bg-gradient-to-t from-[var(--bg)] to-transparent" />
          </aside>
        )}
        <div ref={boardRef} className="lg:shrink-0">
          <Board
            frame={frame}
            loading={loading}
            error={error}
            heightBudget={heightBudget}
            instant={instant}
          />
        </div>
      </div>

      {/* Transport controls + scrubbable timeline, spanning the full
          thread+board row above (not just the mat column) so it reads as
          one wide player bar underneath the whole viewport. */}
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
        atEnd={atEnd}
        onTogglePlay={togglePlay}
        onSelectSpeed={(s) => setSpeed(s)}
        onStepBack={() => { setPlaying(false); setInstant(false); canStepBack && setFrameIndex((i) => i - 1); }}
        onStepForward={() => { setPlaying(false); setInstant(false); canStepForward && setFrameIndex((i) => i + 1); }}
        onTurnBack={() => { setPlaying(false); setInstant(true); stepTurnBack(); }}
        onTurnForward={() => { setPlaying(false); setInstant(true); stepTurnForward(); }}
        onScrub={(i) => { setPlaying(false); setInstant(true); setFrameIndex(i); }}
      />

      {/* Mobile: the thread sits under the controls, rendered in full with
          no scroll envelope of its own — the page scrolls it. Deliberately
          no scrollContainerRef, so the playhead never yanks the page as it
          advances; the spotlight/dimming alone marks where playback is. */}
      {isDesktop === false && (
        <div className="mt-6">
          <BattleLogDetail
            matchId={matchId}
            apiUrl={logUrl}
            maxSequence={frame?.actionIndex ?? -1}
            result={result}
            playerColor={playerColor}
            opponentColor={opponentColor}
            hideScoreCards
          />
        </div>
      )}
    </>
  );
}
