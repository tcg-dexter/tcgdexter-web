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
import { DISCARD_DRAW_STAGES } from "@/lib/replay/frames";
import type {
  DiscardDrawCard,
  DiscardDrawFrame,
  HandCard,
  MulliganFrame,
  ReplayFrame,
  ReplayPayload,
} from "@/lib/replay/frames";
import {
  CARD_BACK_URL,
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
function PrizePips({
  remaining,
  reverse,
}: {
  remaining: number;
  /** Renders the pip row right-to-left. Fill order is always index 0
   *  first regardless — this only mirrors where that pip lands, so the
   *  side whose cluster would otherwise fill outward from its inboard
   *  edge fills outward from the board's edge instead. Both tabs then
   *  read as progressing toward the board's centre as prizes come in. */
  reverse?: boolean;
}) {
  const taken = Math.max(0, Math.min(TOTAL_PRIZES, TOTAL_PRIZES - remaining));
  return (
    <span
      className={`flex shrink-0 items-center gap-1 ${reverse ? "flex-row-reverse" : ""}`}
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
          the mats they belong to, and both names inboard.

          The bottom tab's pips also render right-to-left (`reverse`). The
          top tab's cluster already fills outward from the board's edge
          toward its name without any help — index 0 sits at the outer
          edge and fills first. The bottom cluster is the mirror image of
          that layout, so left-to-right there would fill from its
          inboard/name-adjacent edge outward instead — away from centre,
          not toward it. Reversing its render order (not its fill order)
          is what puts index 0 back at its own outer edge, so both tabs
          converge on the board's centre the same way. */}
      <div
        className="flex items-center gap-2"
        style={{ height: TAB_CONTENT_PX }}
      >
        {hangsBelow && <PrizePips remaining={prizesRemaining} />}
        <span className="min-w-0 truncate text-xs font-bold">{name}</span>
        {!hangsBelow && (
          <PrizePips remaining={prizesRemaining} reverse />
        )}
      </div>
    </div>
  );
}

// At most this many cards render per group; the rest collapse into a "+N"
// chip. Ultra Ball and Trade never come close, but a Professor's Research
// discards a whole hand and draws seven, and a dozen-plus cards on one mat
// would shrink past the point of being recognisable art.
const DISCARD_DRAW_MAX_PER_GROUP = 5;
// Below this the card art stops reading as a card at all, so a group cap or
// a row cap takes over instead of shrinking further. Shared by every
// full-mat card overlay (discard/draw, mulligan) rather than redeclared per
// one, since it's the same "unrecognisable" threshold regardless of which
// overlay is asking.
const OVERLAY_CARD_MIN_PX = 26;

/** A single card face for any full-mat overlay: art when the catalog
 *  resolved it, the bare name over a plain card back otherwise — a
 *  catalog miss still carries the information the art would have, so it's
 *  shown rather than left as an empty rectangle. */
function OverlayCardThumb({
  card,
  width,
  dimmed,
}: {
  card: DiscardDrawCard;
  width: number;
  dimmed?: boolean;
}) {
  return (
    <div
      className={`overflow-hidden rounded shadow-[0_4px_10px_rgba(0,0,0,0.35)] ${
        dimmed ? "opacity-70" : ""
      }`}
      style={{ width, aspectRatio: "245 / 342" }}
      title={card.name}
    >
      {card.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={card.imageUrl} alt={card.name} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-white p-1 text-center text-[8px] font-semibold leading-tight text-black">
          {card.name}
        </div>
      )}
    </div>
  );
}

/**
 * Full-mat overlay for a discard-then-draw exchange — Ultra Ball paying two
 * cards for one, N's Zoroark ex's Trade, and the like. It reads left to
 * right as the transaction itself: what was played, what it cost, what it
 * bought.
 *
 * The three groups arrive a stage at a time as the playhead advances
 * through the exchange's frames, with the row re-centring as it grows. The
 * whole overlay stays mounted across all three (they share an actionIndex,
 * which is the AnimatePresence key), so it fades in once at the start and
 * out once at the end rather than blinking between beats.
 *
 * Card size is solved for rather than fixed. The mat's own dimensions come
 * from a height budget that moves with the viewport, and the number of
 * cards on show is whatever the action happened to involve, so the width is
 * clamped against both: the row has to fit the mat's width, and a card plus
 * its label has to fit the mat's height. It's computed from the *final*
 * stage's card count on every stage, so cards keep one size as groups
 * appear instead of shrinking under the viewer mid-exchange.
 */
function DiscardDrawOverlay({
  detail,
  cardWidth,
  matWidth,
}: {
  detail: DiscardDrawFrame;
  cardWidth: number;
  matWidth: number;
}) {
  // Cards the log counted but couldn't name — the verbose export reports
  // "drew 3 cards" with no list. Shown as facedown backs so the count still
  // reads honestly instead of the overlay silently showing fewer.
  const unknownDrawn = Math.max(0, detail.drawnCount - detail.drawn.length);
  const shown =
    Math.min(1, DISCARD_DRAW_MAX_PER_GROUP) +
    Math.min(detail.discarded.length, DISCARD_DRAW_MAX_PER_GROUP) +
    Math.min(detail.drawn.length + unknownDrawn, DISCARD_DRAW_MAX_PER_GROUP);

  // Width budget: mat, less the overlay's own px-2, the two arrows, and the
  // three inter-group gaps. Each card also carries an 8%-of-itself gap.
  const widthBudget = matWidth - 16 - 2 * 12 - 2 * 16;
  const fromWidth = widthBudget / (shown * 1.08);
  // Height budget: mat height, less breathing room, the label line and the
  // gap above it. 342/245 converts a card's width to its height.
  const fromHeight = (matWidth * MAT_ASPECT - 24 - 12 - 6) / (342 / 245);
  const w = Math.max(
    OVERLAY_CARD_MIN_PX,
    Math.round(Math.min(cardWidth * 0.92, fromWidth, fromHeight)),
  );

  const reached = DISCARD_DRAW_STAGES.indexOf(detail.stage);

  return (
    <motion.div
      className="absolute inset-0 z-30 flex items-center justify-center overflow-hidden rounded-xl px-2"
      // 90% of the page background rather than a flat black scrim, so the
      // overlay reads as the app dimming the mat rather than a modal.
      style={{ backgroundColor: "color-mix(in srgb, var(--bg) 90%, transparent)" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      {/* `layout` on the row is what re-centres it as each group lands:
          justify-center alone would jump, since the row's width changes in
          one frame. AnimatePresence has no exit variants here on purpose —
          groups only ever appear, and the whole overlay leaves at once. */}
      <motion.div layout className="flex items-center gap-3 sm:gap-4">
        <AnimatePresence initial={false}>
          <DiscardDrawGroup
            key="play"
            // A Pokémon-triggered exchange (ability or attack — the parser
            // doesn't distinguish the two textually, both come through as
            // "X's Y used Z") names the ability/attack itself here instead
            // of the generic "Play", since "Play" would be a false claim —
            // nothing was played, the Pokémon already in play acted.
            // abilityName is null for the trainer-card case (Ultra Ball and
            // the like), where "Play" is accurate.
            label={detail.abilityName ?? "Play"}
            cards={[detail.source]}
            width={w}
          />
          {reached >= 1 && (
            <DiscardDrawGroup
              key="discard"
              label="Discard"
              cards={detail.discarded}
              width={w}
              dimmed
              leadWithArrow
            />
          )}
          {reached >= 2 && (
            <DiscardDrawGroup
              key="draw"
              label="Draw"
              cards={detail.drawn}
              unknownCount={unknownDrawn}
              width={w}
              leadWithArrow
            />
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

function DiscardDrawGroup({
  label,
  cards,
  width,
  unknownCount = 0,
  dimmed,
  leadWithArrow,
}: {
  label: string;
  cards: DiscardDrawCard[];
  width: number;
  /** Facedown placeholders for cards the log counted but didn't name. */
  unknownCount?: number;
  /** Discards read as spent, so they sit back a little from the other two. */
  dimmed?: boolean;
  /** Chevron before the group. Carried by the group rather than placed
   *  between siblings so it animates in with the stage it introduces. */
  leadWithArrow?: boolean;
}) {
  const total = cards.length + unknownCount;
  if (total === 0) return null;
  // Trim the named cards first and the facedown placeholders after, so what
  // survives the cap is the part a viewer can actually learn something from.
  const shownCards = cards.slice(0, DISCARD_DRAW_MAX_PER_GROUP);
  const shownUnknown = Math.min(
    unknownCount,
    DISCARD_DRAW_MAX_PER_GROUP - shownCards.length,
  );
  const hidden = total - shownCards.length - shownUnknown;
  return (
    <motion.div
      layout
      className="flex min-w-0 shrink items-center gap-3 sm:gap-4"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      {leadWithArrow && (
        <span aria-hidden className="shrink-0 text-sm font-bold text-text-muted">
          ›
        </span>
      )}
      <div className="flex min-w-0 shrink flex-col items-center gap-1.5">
      <div className="flex items-center" style={{ gap: Math.round(width * 0.08) }}>
        {shownCards.map((card, i) => (
          <OverlayCardThumb key={`${card.name}-${i}`} card={card} width={width} dimmed={dimmed} />
        ))}
        {Array.from({ length: shownUnknown }, (_, i) => (
          <div
            key={`unknown-${i}`}
            aria-label="Unrevealed card"
            className="rounded bg-gradient-to-br from-[#3b4a63] to-[#1f2733] shadow-[0_4px_10px_rgba(0,0,0,0.35)]"
            style={{ width, aspectRatio: "245 / 342" }}
          />
        ))}
        {hidden > 0 && (
          <span className="shrink-0 pl-0.5 text-[10px] font-bold tabular-nums text-text-secondary">
            +{hidden}
          </span>
        )}
      </div>
      <span className="whitespace-nowrap text-[9px] font-bold uppercase tracking-wider text-text-secondary">
        {label}
      </span>
      </div>
    </motion.div>
  );
}

// Vertical space between mulligan rows in the overlay.
const MULLIGAN_ROW_GAP_PX = 10;

/**
 * Full-mat overlay for a mulligan sequence — one row per mulligan taken,
 * each row the full hand it revealed. Unlike the discard/draw overlay's
 * three differently-labelled groups, every row here is the same kind of
 * thing, so the rows carry no individual label; a single "Mulligan" caption
 * over the stack is enough to say what's being shown.
 *
 * The overlay mounts once at the first row and stays mounted as later ones
 * land — see ReplayViewer's key on this component, a fixed per-actor string
 * rather than the per-beat actionIndex the discard/draw overlay uses,
 * because a mulligan beat's underlying action changes partway through the
 * sequence (see MulliganFrame) and keying on it would restart the fade
 * mid-sequence.
 *
 * Card size solves against the mat's width (fitting the widest row) and
 * its height (fitting every eventual row stacked), using `totalRows` so
 * cards hold one size across the whole sequence instead of shrinking each
 * time a row lands — the same principle as the discard/draw overlay.
 */
function MulliganOverlay({
  detail,
  cardWidth,
  matWidth,
}: {
  detail: MulliganFrame;
  cardWidth: number;
  matWidth: number;
}) {
  const cardsPerRow = Math.max(1, ...detail.rows.map((r) => r.length));

  // Width budget: mat, less the overlay's own px-2. Each card carries an
  // 8%-of-itself gap, same ratio the discard/draw overlay uses.
  const widthBudget = matWidth - 16;
  const fromWidth = widthBudget / (cardsPerRow * 1.08);
  // Height budget: mat height, less breathing room and the caption line,
  // divided across every row the sequence will eventually show — not just
  // the ones revealed so far — with a gap between each. 342/245 converts a
  // card's height back to the width that produces it.
  const availableForRows =
    matWidth * MAT_ASPECT - 24 - 16 - (detail.totalRows - 1) * MULLIGAN_ROW_GAP_PX;
  const fromHeight = availableForRows / detail.totalRows / (342 / 245);
  const w = Math.max(
    OVERLAY_CARD_MIN_PX,
    Math.round(Math.min(cardWidth * 0.92, fromWidth, fromHeight)),
  );

  return (
    <motion.div
      className="absolute inset-0 z-30 flex items-center justify-center overflow-hidden rounded-xl px-2"
      style={{ backgroundColor: "color-mix(in srgb, var(--bg) 90%, transparent)" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      {/* `layout` re-centres the stack vertically as rows land, the same
          way the discard/draw overlay's row re-centres horizontally. */}
      <motion.div layout className="flex flex-col items-center" style={{ gap: MULLIGAN_ROW_GAP_PX }}>
        <span className="whitespace-nowrap text-[9px] font-bold uppercase tracking-wider text-text-secondary">
          Mulligan
        </span>
        <AnimatePresence initial={false}>
          {detail.rows.map((row, i) => (
            <motion.div
              key={i}
              layout
              className="flex items-center"
              style={{ gap: Math.round(w * 0.08) }}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              {row.map((card, j) => (
                <OverlayCardThumb key={`${card.name}-${j}`} card={card} width={w} />
              ))}
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

// Share of the card's cropped top that shows, in units of the card's own
// width — the aspect ratio pins height to width, so this is the one number
// that decides how much of each card is visible above the fade.
const HAND_STRIP_VISIBLE_PCT = 70;
// Distance from the mat above, standing in for the label's old margin now
// that there's no label to carry it — the strip needs to read as attached
// to the mat, not as a floating, unrelated row.
const HAND_STRIP_TOP_GAP_PX = 6;

/**
 * The submitting user's hand, anchored directly below their mat — always
 * the bottom mat now that Board pins the player there (see Board's comment
 * on why side/edge stay fixed to visual slot). Every card renders cropped
 * to its top 70% with a gradient fading the cut edge into the page
 * background, rather than showing full cards or hiding the row entirely:
 * a hand can run to seven-plus cards, and this is what lets the strip stay
 * compact without either overflowing or needing its own scroll.
 *
 * Recomputed every frame like the rest of the board, so it always shows
 * the hand as of wherever the playhead currently sits — cards drawn appear,
 * cards played or discarded disappear, live as the viewer steps or scrubs.
 * An unrevealed card (the log never named it — see HandCard) renders as a
 * face-down back rather than the literal placeholder name.
 */
function HandStrip({
  cards,
  cardWidth,
  instant,
  onCardClick,
}: {
  cards: HandCard[];
  cardWidth: number;
  instant: boolean;
  /** Opens the mat-overlay inspector for a tapped card. Omitted (or a
   *  card that isn't `revealed`) means the card isn't clickable — there's
   *  nothing to inspect about a card the log never named. */
  onCardClick?: (target: InspectTarget) => void;
}) {
  if (cards.length === 0) return null;
  const cardHeight = Math.round((cardWidth * 342) / 245);
  const visibleHeight = Math.round((cardHeight * HAND_STRIP_VISIBLE_PCT) / 100);

  return (
    <div style={{ marginTop: HAND_STRIP_TOP_GAP_PX }}>
      <div className="flex flex-wrap items-start justify-center gap-x-2 gap-y-3">
        <AnimatePresence initial={false}>
          {cards.map((card) => {
            const clickable = card.revealed && onCardClick != null;
            return (
            <motion.div
              key={card.id}
              layout
              // No drop shadow: it would sit below the card's cropped edge,
              // right where the gradient is trying to fade the card into
              // the background — a shadow there reads as a hard edge under
              // the fade, contradicting it.
              className={`relative overflow-hidden rounded ${clickable ? "cursor-pointer" : ""}`}
              style={{ width: cardWidth, height: visibleHeight }}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: instant ? 0 : 0.25, ease: "easeOut" }}
              title={card.revealed ? card.name : undefined}
              role={clickable ? "button" : undefined}
              onClick={
                clickable
                  ? () => onCardClick!({ kind: "card", name: card.name, imageUrl: card.imageUrl })
                  : undefined
              }
            >
              {/* The image renders at the card's FULL height inside a
                  wrapper cropped to visibleHeight — top-anchored, so it's
                  the bottom that's cut off rather than the top. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={card.revealed ? card.imageUrl ?? undefined : CARD_BACK_URL}
                alt={card.revealed ? card.name : "Face-down card"}
                className="absolute inset-x-0 top-0 w-full object-cover"
                style={{ height: cardHeight }}
              />
              {card.revealed && !card.imageUrl && (
                // Catalog miss on a revealed card — same treatment as the
                // overlay cards: show the name rather than nothing.
                <div className="absolute inset-0 flex items-center justify-center bg-white p-1 text-center text-[8px] font-semibold leading-tight text-black">
                  {card.name}
                </div>
              )}
              {/* Fades the cropped edge into the page background instead of
                  ending the card on a hard cut line — the same "peeking
                  content, gradient into var(--bg)" treatment the desktop
                  thread uses at its own scroll edges. */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-b from-transparent to-[var(--bg)]" />
            </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

// Attached-cards row, overlaid on the bottom of the big card in the
// inspector: each attached card's height as a percentage of the big
// card's own — width follows from the card aspect ratio.
const ATTACHED_ROW_PCT = 33;
// The row's viewport is capped to this many cards; anything past it stays a
// single row and scrolls (swipe, or the chevrons) instead of wrapping to a
// second line, which would need the whole overlay resized to make room.
const ATTACHED_ROW_MAX_VISIBLE = 7;
const ATTACHED_ROW_GAP_PX = 6;
// A chevron button's own width (h-5 w-5 = 20px) plus the gap-1 (4px)
// beside it — the fixed allowance each side of the row spends on chrome
// rather than card content.
const ATTACHED_ROW_CHEVRON_PX = 24;

/**
 * A single-row, horizontally scrollable strip of attached-card thumbnails.
 * Sized to show ATTACHED_ROW_MAX_VISIBLE at once — seven is rarely all of
 * them (a heavily-loaded Pokémon can carry more energy than that alone —
 * see the energy footer's own >4 collapse rule elsewhere on the board) —
 * so anything past that scrolls into view rather than wrapping to a second
 * row, which the inspector isn't laid out to make room for.
 *
 * Scrolling works two ways at once: native horizontal overflow gives swipe
 * on touch and trackpad for free, and the chevrons step exactly one card
 * at a time for a mouse. Both drive the same underlying scrollLeft, so
 * they can't disagree about position. Chevrons render only when there's
 * something to scroll to — `overflow.left`/`overflow.right` — and disable
 * themselves via CSS pointer-events rather than being removed, so the
 * button geometry (and the strip's width) doesn't jump as attachments are
 * scrolled through.
 */
function AttachedCardsRow({
  cards,
  cardWidth,
}: {
  cards: DiscardDrawCard[];
  cardWidth: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });

  const updateOverflow = () => {
    const el = scrollRef.current;
    if (!el) return;
    setOverflow({
      left: el.scrollLeft > 1,
      right: el.scrollLeft < el.scrollWidth - el.clientWidth - 1,
    });
  };

  useIsomorphicLayoutEffect(() => {
    updateOverflow();
    // Card count changes as the playhead moves between the discard/draw
    // and mulligan-style beats this same board renders — re-measure
    // whenever the set of cards shown changes rather than only once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards.length, cardWidth]);

  const step = cardWidth + ATTACHED_ROW_GAP_PX;
  function scrollByCard(dir: 1 | -1) {
    scrollRef.current?.scrollBy({ left: dir * step, behavior: "smooth" });
  }

  const viewportWidth =
    Math.min(cards.length, ATTACHED_ROW_MAX_VISIBLE) * cardWidth +
    (Math.min(cards.length, ATTACHED_ROW_MAX_VISIBLE) - 1) * ATTACHED_ROW_GAP_PX;

  return (
    <div className="flex items-center gap-1">
      <AttachedRowChevron direction="left" visible={overflow.left} onClick={() => scrollByCard(-1)} />
      <div
        ref={scrollRef}
        onScroll={updateOverflow}
        className="flex items-end overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ width: viewportWidth, gap: ATTACHED_ROW_GAP_PX, scrollSnapType: "x proximity" }}
      >
        {cards.map((c, i) => (
          <div key={`${c.name}-${i}`} className="shrink-0" style={{ scrollSnapAlign: "start" }}>
            <OverlayCardThumb card={c} width={cardWidth} />
          </div>
        ))}
      </div>
      <AttachedRowChevron direction="right" visible={overflow.right} onClick={() => scrollByCard(1)} />
    </div>
  );
}

function AttachedRowChevron({
  direction,
  visible,
  onClick,
}: {
  direction: "left" | "right";
  /** There's nothing that way to scroll to. Kept mounted rather than
   *  unmounted so the row's own width never shifts as the user scrolls
   *  between having and not having room left in a given direction. */
  visible: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!visible}
      aria-label={direction === "left" ? "Scroll attached cards left" : "Scroll attached cards right"}
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition disabled:opacity-0"
    >
      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d={direction === "left" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"}
        />
      </svg>
    </button>
  );
}

/**
 * Empty-fill, bordered circle close button shared by every full-mat overlay
 * that needs one (the card inspector, the discard-pile inspector) — an
 * outline in the theme's own primary-text colour rather than a filled
 * bg-black/50 treatment, so it tracks light/dark mode automatically via
 * text-primary's own CSS variable instead of needing a separate dark:
 * variant per overlay.
 */
function OverlayCloseButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      className="absolute left-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-text-primary text-text-primary transition hover:bg-text-primary/10"
    >
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}

/**
 * First stage of the two-stage card inspector: an XL card image on the
 * SAME full-mat overlay treatment as the discard/draw and mulligan
 * overlays, rather than jumping straight to the full-screen viewer. It
 * mounts on whichever mat the tapped card belongs to — see Board's two
 * InspectContext.Provider — so a tap on an opponent card inspects over the
 * opponent's mat and a tap on the player's own card (on their mat OR in
 * their hand strip) inspects over the player's.
 *
 * A Pokémon target also gets a row of everything attached to it — energy
 * and Tools alike, see PokemonFrame.attachedCards — pinned to the bottom
 * edge of the MAT (this overlay's own footprint), not the card: the card
 * centres in the mat and is usually shorter than it, so anchoring to the
 * card left the row floating over the middle of the mat rather than
 * sitting at its floor. This also keeps the primary card at exactly the
 * same full size the plain-card case already used (fit-to-mat on both
 * axes, independent of whether anything is attached) — the row overlays
 * whatever it overlaps rather than sharing space with the card. A gradient
 * scrim behind the row is what keeps small thumbnails legible against
 * whatever's behind them, mat or card art alike.
 *
 * Tapping the big card again escalates to the existing full-screen
 * ReplayCardInspector (onExpand); the small circled X closes back to the
 * board instead. Attached cards themselves aren't tappable — they're a
 * reference row, not their own inspector target. z-40, one above the
 * discard/draw and mulligan overlays' z-30, since it's the more focused of
 * the two if a tap ever lands while one of those is already showing.
 */
function MatCardInspector({
  target,
  cardWidth,
  matWidth,
  onExpand,
  onClose,
}: {
  target: InspectTarget;
  cardWidth: number;
  matWidth: number;
  onExpand: () => void;
  onClose: () => void;
}) {
  const card: DiscardDrawCard =
    target.kind === "pokemon"
      ? { name: target.mon.name, imageUrl: target.mon.imageUrl }
      : { name: target.name, imageUrl: target.imageUrl };
  const attachedCards =
    target.kind === "pokemon" ? target.mon.attachedCards ?? [] : [];

  // Fit the mat on both axes, same clamp-against-both-dimensions approach
  // as the discard/draw and mulligan overlays' card sizing. 32px reserves
  // breathing room from the mat edges on every side. Unaffected by
  // attachedCards — the row below overlays the card rather than sharing
  // its footprint, so there's nothing extra to budget for here.
  const heightBudget = matWidth * MAT_ASPECT - 32;
  const fromWidth = matWidth - 32;
  const fromHeight = (heightBudget * 245) / 342;
  const w = Math.max(OVERLAY_CARD_MIN_PX, Math.round(Math.min(fromWidth, fromHeight)));
  const cardH = Math.round((w * 342) / 245);
  const attachedH = Math.round((cardH * ATTACHED_ROW_PCT) / 100);
  // Clamped against the mat's width too, not just the card's height: at up
  // to ATTACHED_ROW_MAX_VISIBLE cards wide plus a chevron on each side, the
  // row's own natural (33%-of-card-height) size could ask for more width
  // than a narrow mat has — and unlike the vertical floor below, a chevron
  // pushed outside the mat isn't just clipped by the mat's overflow-hidden,
  // it's clipped UNREACHABLE, since it's what the user would tap to see the
  // rest. ATTACHED_ROW_CHEVRON_PX is that button's own width plus its gap
  // to the strip, counted on both sides.
  const attachedWFromMat =
    (matWidth - 32 - 2 * ATTACHED_ROW_CHEVRON_PX - (ATTACHED_ROW_MAX_VISIBLE - 1) * ATTACHED_ROW_GAP_PX) /
    ATTACHED_ROW_MAX_VISIBLE;
  // Same floor the discard/draw and mulligan overlays hold their own
  // thumbnails to — it wins over the mat-width clamp above on a narrow
  // enough mat (a phone-width mat, roughly), so the row can end up wider
  // than the mat has room for. The overlay's own overflow-hidden then
  // clips whatever doesn't fit, right chevron included. That's an
  // acceptable trade for keeping the visible thumbnails legible rather
  // than shrinking them past recognition to make room for the affordance
  // that reveals more of them — and native swipe still works to reach the
  // clipped cards even when the chevron that would have done the same
  // job is the part that's cut off.
  const attachedW = Math.max(
    OVERLAY_CARD_MIN_PX,
    Math.round(Math.min((attachedH * 245) / 342, attachedWFromMat)),
  );

  return (
    <motion.div
      className="absolute inset-0 z-40 flex items-center justify-center overflow-hidden rounded-xl px-2"
      style={{ backgroundColor: "color-mix(in srgb, var(--bg) 90%, transparent)" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <OverlayCloseButton onClick={onClose} label="Close card preview" />
      <button
        type="button"
        onClick={onExpand}
        aria-label={`Open ${card.name} full screen`}
        className="relative overflow-hidden rounded-lg shadow-[0_8px_20px_rgba(0,0,0,0.4)]"
        style={{ width: w, aspectRatio: "245 / 342" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={card.imageUrl ?? CARD_BACK_URL}
          alt={card.name}
          className="h-full w-full object-cover"
        />
        {!card.imageUrl && (
          <div className="absolute inset-x-2 top-2 rounded bg-black/60 px-2 py-1 text-center text-sm font-semibold leading-tight text-white line-clamp-2">
            {card.name}
          </div>
        )}
      </button>
      {attachedCards.length > 0 && (
        // Anchored to the MAT's own bottom edge (this div's positioning
        // parent is the full-mat overlay, not the card button above), not
        // the card's — the card centres in the mat and is usually shorter
        // than it, so anchoring to the card instead left the row floating
        // near the middle of the mat rather than sitting at its floor. z-10
        // over the card so it still reads as "on top of" wherever the two
        // happen to overlap. Not pointer-events-none like the rest of this
        // overlay's decoration: the row is interactive now (scroll,
        // chevrons), so it has to actually receive the taps/swipes aimed
        // at it rather than passing them through to the card underneath —
        // it's a sibling of the card button, not nested inside it, so this
        // can't accidentally trigger the card's own onExpand.
        <div
          className="absolute inset-x-0 bottom-0 z-10 flex justify-center px-2 pb-3 pt-6"
          style={{
            // Scrim sized to the row's own fixed height rather than a
            // fraction of the mat — the row no longer grows into a second
            // line, so there's no variable height left to size against.
            backgroundImage: "linear-gradient(to top, rgba(0,0,0,0.75), transparent)",
          }}
        >
          <AttachedCardsRow cards={attachedCards} cardWidth={attachedW} />
        </div>
      )}
    </motion.div>
  );
}

// Grid geometry for the discard-pile inspector. Fixed at 7 columns per the
// request; 4 rows is what fits comfortably above a phone-width mat without
// shrinking cards past legibility, so a pile beyond that (28 cards — a
// realistic late-game count) scrolls vertically inside the grid rather than
// growing the overlay or shrinking further.
const DISCARD_GRID_COLS = 7;
const DISCARD_GRID_VISIBLE_ROWS = 4;
const DISCARD_GRID_GAP_PX = 6;

/**
 * Full-mat overlay showing the ENTIRE discard pile as a grid, rather than
 * just its top card — opened from the discard pile itself (see PlayerMat's
 * onDiscardClick), a different trigger from the tap-any-card MatCardInspector
 * above, so this is its own component rather than a third InspectTarget
 * kind threaded through BoardKit's shared card components.
 *
 * Cards aren't individually tappable here, same as the discard/draw and
 * mulligan overlays' groups — this grid already IS the "look closer" step
 * for these cards, sized to read at a glance rather than needing its own
 * escalation to something bigger.
 */
function DiscardPileOverlay({
  cards,
  matWidth,
  onClose,
}: {
  cards: DiscardDrawCard[];
  matWidth: number;
  onClose: () => void;
}) {
  const matHeight = matWidth * MAT_ASPECT;
  // Width budget: mat, less the overlay's own px-2, seven cards and six
  // inter-card gaps.
  const fromWidth =
    (matWidth - 16 - (DISCARD_GRID_COLS - 1) * DISCARD_GRID_GAP_PX) / DISCARD_GRID_COLS;
  // Height budget: mat height, less room for the close button up top and
  // the caption + breathing room below it, divided across the four visible
  // rows with a gap between each. 342/245 converts a card's height back to
  // the width that produces it — same conversion every other overlay here
  // uses for the same reason.
  const fromHeight =
    ((matHeight - 56 - (DISCARD_GRID_VISIBLE_ROWS - 1) * DISCARD_GRID_GAP_PX) /
      DISCARD_GRID_VISIBLE_ROWS) *
    (245 / 342);
  const w = Math.max(OVERLAY_CARD_MIN_PX, Math.round(Math.min(fromWidth, fromHeight)));
  const cardH = Math.round((w * 342) / 245);
  const gridWidth = DISCARD_GRID_COLS * w + (DISCARD_GRID_COLS - 1) * DISCARD_GRID_GAP_PX;
  const gridVisibleHeight =
    DISCARD_GRID_VISIBLE_ROWS * cardH + (DISCARD_GRID_VISIBLE_ROWS - 1) * DISCARD_GRID_GAP_PX;

  return (
    <motion.div
      className="absolute inset-0 z-40 flex items-center justify-center overflow-hidden rounded-xl px-2"
      style={{ backgroundColor: "color-mix(in srgb, var(--bg) 90%, transparent)" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <OverlayCloseButton onClick={onClose} label="Close discard pile" />
      <div className="flex flex-col items-center gap-1.5" style={{ maxHeight: matHeight - 24 }}>
        <span className="whitespace-nowrap text-[9px] font-bold uppercase tracking-wider text-text-secondary">
          Discard Pile · {cards.length}
        </span>
        {/* The only scrolling surface in this overlay — a pile past
            DISCARD_GRID_VISIBLE_ROWS rows scrolls here instead of growing
            the grid past the mat or shrinking cards further. */}
        <div
          className="grid overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{
            gridTemplateColumns: `repeat(${DISCARD_GRID_COLS}, ${w}px)`,
            gap: DISCARD_GRID_GAP_PX,
            width: gridWidth,
            maxHeight: gridVisibleHeight,
          }}
        >
          {cards.map((c, i) => (
            <OverlayCardThumb key={`${c.name}-${i}`} card={c} width={w} />
          ))}
        </div>
      </div>
    </motion.div>
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
  // Stage 2: the existing full-screen viewer, unchanged — only reachable
  // now by tapping the card again inside stage 1 (see onExpand below).
  const [inspect, setInspect] = useState<InspectTarget | null>(null);
  // Stage 1: which actor's mat the mat-overlay inspector is showing over,
  // and what it's showing. A tap anywhere always names an actor (the two
  // InspectContext.Provider below are each scoped to one mat's data, and
  // HandStrip's cards are always the player's), so there's one flag for
  // both "is it open" and "which mat it belongs on."
  const [matInspect, setMatInspect] = useState<{
    actor: "player" | "opponent";
    target: InspectTarget;
  } | null>(null);
  // Discard-pile inspector: which actor's mat it's showing over, same
  // one-flag-does-both-jobs shape as matInspect above. A separate slot from
  // matInspect rather than a third InspectTarget kind — see
  // DiscardPileOverlay's own comment — so opening one explicitly clears the
  // other below, keeping only one mat overlay up at a time per mat.
  const [discardInspect, setDiscardInspect] = useState<"player" | "opponent" | null>(
    null,
  );
  // Every path that opens the card inspector goes through this, so it can't
  // forget to close whichever discard-pile overlay happens to be open —
  // the reverse (discard pile clearing matInspect) is handled inline at its
  // own two call sites below since there's only one of it.
  function openMatInspect(actor: "player" | "opponent", target: InspectTarget) {
    setDiscardInspect(null);
    setMatInspect({ actor, target });
  }

  return (
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
        <>
        <div className="flex flex-col" style={{ gap: TAB_GAP_PX }}>
          {/* z-10 on the mat wrappers so each mat paints over the tab tucked
              beneath it. The wrappers are plain positioning shells — mat
              geometry stays entirely inside PlayerMat.

              `side`/`edge` are pinned to which visual slot a block renders
              (top, oriented "player"-style with its tray pinned to the
              slot's own floor; bottom, oriented "opponent"-style) — they
              are NOT which actor's data the block shows. The opponent
              always occupies the top slot and the submitting user (the log
              owner — see PokemonFrame) always occupies the bottom one, so
              the hand strip below the board always has a stable mat to sit
              under. Swap the data bound to each block, never `side`/`edge`
              themselves, if this ever needs to change. */}
          {/* Scoped to just this mat's data, so a tap anywhere inside knows
              it's the opponent's card without threading an actor prop
              through BoardKit's shared card components. */}
          <InspectContext.Provider
            value={(target) => openMatInspect("opponent", target)}
          >
          <div className="relative z-10">
            <PlayerMat
              side="player"
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
              onDiscardClick={() => {
                setMatInspect(null);
                setDiscardInspect("opponent");
              }}
            />
            <AnimatePresence>
              {frame.discardDraw?.actor === "opponent" && (
                <DiscardDrawOverlay
                  key={frame.actionIndex}
                  detail={frame.discardDraw}
                  cardWidth={cardWidth}
                  matWidth={matWidth}
                />
              )}
            </AnimatePresence>
            <AnimatePresence>
              {frame.mulligan?.actor === "opponent" && (
                <MulliganOverlay
                  key="mulligan-opponent"
                  detail={frame.mulligan}
                  cardWidth={cardWidth}
                  matWidth={matWidth}
                />
              )}
            </AnimatePresence>
            <AnimatePresence>
              {matInspect?.actor === "opponent" && (
                <MatCardInspector
                  target={matInspect.target}
                  cardWidth={cardWidth}
                  matWidth={matWidth}
                  onExpand={() => {
                    setInspect(matInspect.target);
                    setMatInspect(null);
                  }}
                  onClose={() => setMatInspect(null)}
                />
              )}
            </AnimatePresence>
            <AnimatePresence>
              {discardInspect === "opponent" && (
                <DiscardPileOverlay
                  cards={frame.opponent.discard}
                  matWidth={matWidth}
                  onClose={() => setDiscardInspect(null)}
                />
              )}
            </AnimatePresence>
          </div>
          </InspectContext.Provider>
          <MatTab
            edge="bottom"
            name={frame.opponent.handle ?? "Opponent"}
            prizesRemaining={frame.opponent.prizesRemaining}
          />
          <MatTab
            edge="top"
            name={frame.player.handle ?? "Player"}
            prizesRemaining={frame.player.prizesRemaining}
          />
          <InspectContext.Provider
            value={(target) => openMatInspect("player", target)}
          >
          <div className="relative z-10">
            <PlayerMat
              side="opponent"
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
              onDiscardClick={() => {
                setMatInspect(null);
                setDiscardInspect("player");
              }}
            />
            <AnimatePresence>
              {frame.discardDraw?.actor === "player" && (
                <DiscardDrawOverlay
                  key={frame.actionIndex}
                  detail={frame.discardDraw}
                  cardWidth={cardWidth}
                  matWidth={matWidth}
                />
              )}
            </AnimatePresence>
            <AnimatePresence>
              {frame.mulligan?.actor === "player" && (
                <MulliganOverlay
                  key="mulligan-player"
                  detail={frame.mulligan}
                  cardWidth={cardWidth}
                  matWidth={matWidth}
                />
              )}
            </AnimatePresence>
            <AnimatePresence>
              {matInspect?.actor === "player" && (
                <MatCardInspector
                  target={matInspect.target}
                  cardWidth={cardWidth}
                  matWidth={matWidth}
                  onExpand={() => {
                    setInspect(matInspect.target);
                    setMatInspect(null);
                  }}
                  onClose={() => setMatInspect(null)}
                />
              )}
            </AnimatePresence>
            <AnimatePresence>
              {discardInspect === "player" && (
                <DiscardPileOverlay
                  cards={frame.player.discard}
                  matWidth={matWidth}
                  onClose={() => setDiscardInspect(null)}
                />
              )}
            </AnimatePresence>
          </div>
          </InspectContext.Provider>
        </div>
        {/* Player's hand, always the bottom mat's now that the swap above
            pins the submitting user there — see HandStrip. Cards open
            through the same mat-overlay inspector as the mat itself,
            always on the player's (bottom) mat, since a hand card is
            always the player's own. */}
        <HandStrip
          cards={frame.player.hand}
          cardWidth={cardWidth}
          instant={instant}
          onCardClick={(target) => openMatInspect("player", target)}
        />
        </>
      )}
      {inspect && (
        <ReplayCardInspector target={inspect} onClose={() => setInspect(null)} />
      )}
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
          here, so items-center puts them on its midline by construction.
          Padding and the gap both step up at sm: — below that, the two
          capsules at their full spread ran past a phone's content width
          (~343px at 375px viewport) and forced the row to overflow rather
          than wrap, since nothing here is allowed to shrink onto a second
          line. */}
      <div className="mt-1.5 flex items-center justify-center gap-1.5 sm:gap-3">
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
          className="flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-full border border-black/10 dark:border-white/10 text-text-primary hover:bg-surface disabled:opacity-30"
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
  // Padding steps up at sm: (see the control row's comment) — this is the
  // capsule's half of that: the two chevron paddings plus the label's give
  // each capsule its width, and both were sized for the wide desktop
  // spread rather than a phone's content column.
  const arrowClass =
    "self-stretch px-2 py-2 sm:px-5 text-text-secondary transition-colors hover:text-text-primary disabled:opacity-30 disabled:hover:text-text-secondary";
  return (
    <div className={`inline-flex shrink-0 items-center rounded-full border ${edge}`}>
      <button
        type="button"
        onClick={onBack}
        disabled={!canBack}
        aria-label={`Previous ${label.toLowerCase()}`}
        title={`Previous ${label.toLowerCase()}`}
        className={`${arrowClass} rounded-l-full border-r ${edge} pl-3 sm:pl-6`}
      >
        <span aria-hidden>‹</span>
      </button>
      {/* Every label stacked in one grid cell, all but this capsule's own
          hidden. The browser sizes the cell to the widest of them, so both
          capsules match without measuring text or hard-coding a width —
          and it stays true if a label is ever renamed. */}
      <span className="grid select-none px-2 sm:px-5 text-xs font-semibold text-text-secondary">
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
        className={`${arrowClass} rounded-r-full border-l ${edge} pr-3 sm:pr-6`}
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
          advances. maxSequence is likewise omitted: that's what drives the
          desktop spotlight/dimming, and dimming exists there to mark
          progress through a thread the user isn't seeing all of at once.
          Mobile already shows the whole thread at full opacity, so there's
          nothing for it to spotlight against — passing it would just dim
          everything after the playhead for no reason. */}
      {isDesktop === false && (
        <div className="mt-6">
          <BattleLogDetail
            matchId={matchId}
            apiUrl={logUrl}
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
