"use client";

// Replay 2.0's playback viewer — a fork of app/components/replay/ReplayViewer.
//
// Layout, controls and wiring are deliberately inherited whole: the same 16:9
// thread + board window, the same transport (scrubber, action step, turn step,
// play/pause/replay, speed menu), the same two-stage inspectors, the same
// thread sync. What 2.0 changes is how the board PERFORMS what the frames
// already say — see lib/replay2/beats.ts and ./director.
//
// It is a copy rather than a prop on the original because the original is
// rendered by the public battles page and the home-page showcase, and 2.0's
// standing promise is that nothing in production changes while it's built.
// The two will converge again when 2.0 ships; until then, fixes that belong
// to BOTH need applying twice, deliberately.
//
// Board rendering lives in the matching BoardKit2 fork.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
  SideFrame,
} from "@/lib/replay/frames";
import {
  BOARD_GRADIENT,
  CARD_BACK_URL,
  CardSleeve,
  InspectContext,
  PlayerMat,
  ReplayCardInspector,
  computeReplayCardWidth,
  type InspectTarget,
} from "./BoardKit2";
import { indexBeats, type Beat, type ReplayPayload2 } from "@/lib/replay2/beats";
import { useDirector } from "./director/useDirector";
import { BeatProvider } from "./director/BeatContext";
import { FxCanvas } from "./fx/FxCanvas";
import { drawFlightFor } from "./fx/fxBus";
import { GameEndFlourish } from "./fx/GameEndFlourish";
import { MoveNamePlate } from "./fx/MoveNamePlate";
import { DrawFlight } from "./fx/DrawFlight";
import { useCamera } from "./fx/useCamera";
import { specDuration } from "./director/choreography";
import type { BeatPhase } from "./director/choreography";
import { MAT_ASPECT } from "@/lib/playmat-layout";
import { MAT_STYLES } from "@/app/admin-tools/deck-mat/DeckMatClient";
import { lookupCard } from "@/lib/engine";

/**
 * Mat gradient for a side, keyed off that deck's hero Pokémon (the
 * highest-damage attacker across the game — ReplayPayload's
 * playerPrimaryName/opponentPrimaryName) rather than the fixed
 * fire-lightning look every board used to share. MAT_STYLES already has
 * one gradient per energy type (same key set as the card catalog's
 * `types`), so this is a straight name → type → gradient lookup with the
 * old default as the fallback for a catalog miss or a colorless hero.
 */
function matGradientForPrimary(name: string | null): string {
  const type = name ? lookupCard(name)?.types?.[0] : null;
  return (type && MAT_STYLES.find((s) => s.key === type)?.gradient) || BOARD_GRADIENT;
}

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
 *  parked on the final frame — the press restarts the battle rather than
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

/**
 * DOM id on the top (opponent) mat — the board's first painted row, so
 * scrolling it to the top of the window puts the whole board in view. Any
 * surface with a "jump to the replay" affordance targets this rather than
 * the viewer's outer wrapper, which starts above the mats at the header.
 * Exported so the caller can't drift from what's actually rendered (see
 * BattleLogPage's WATCH REPLAY pill). Assumes one mounted viewer per page,
 * which is true everywhere it's used today.
 */
export const REPLAY_TOP_MAT_ID = "replay-top-mat";

/**
 * Scroll offset for that anchor, expressed as scroll-margin rather than as
 * arithmetic at the call site: it belongs with the element being scrolled
 * to, and scrollIntoView({ block: "start" }) honors it for free.
 *
 * The goal is flush: WATCH REPLAY puts the top mat at the top of the
 * browser's visible content, not a comfortable distance below it. So this
 * carries ONLY the clearance that's mechanically required to keep the mat
 * out from under fixed chrome, plus a trim taken back off that minimum on
 * mobile so the destination reads as reaching a touch further down the
 * page still — bumped four times now (10px, 10px, 10px, then a landed-
 * position target of 20px from the viewport top, which is a 36px trim),
 * each time by request after checking the previous amount on a real
 * device. Desktop stays at exactly its mechanical minimum — see below —
 * since that's already confirmed right; nothing is piled on top of it,
 * and nothing should be.
 *
 * Below xl the site chrome is a sticky 56px (h-14) toolbar that would
 * otherwise cover the top of the mat, and viewport-fit=cover means the
 * page's top edge can run under a notch, so the toolbar's own ceiling is
 * the safe-area inset — 3.5rem + env(safe-area-inset-top) is that
 * mechanical minimum, and the 36px trim comes off it, landing the mat's
 * top edge 20px below the viewport top (56 - 36). Comfortably past half
 * the toolbar's own 56px height now: more of the mat sits behind it than
 * in front of it. The toolbar is translucent and blurred (`backdrop-blur-
 * xl bg-bg/70`, SiteNav.tsx), not opaque, so that sliver stays faintly
 * visible rather than being hard-clipped, but this is well past the point
 * where a bigger trim reads as "reaches a touch further" rather than "the
 * mat looks cut off" — if this needs to grow again, worth checking on a
 * real device rather than nudging blind. From xl up the chrome is the two
 * fixed side rails and there is nothing overhead, so it's exactly the
 * inset (usually 0 outside a notched device) and nothing else —
 * scrollIntoView lands the mat's top edge at the literal top of the
 * viewport there.
 *
 * Recorded because it's non-obvious and bit this exact constant twice: a
 * LARGER value here means LESS scrolling, not more. scroll-margin-top
 * reserves that much space above the target, so growing it makes the
 * browser stop earlier and leaves more of the page above the mat still
 * visible — confirmed directly (same element, same position, only the
 * margin changed): 20px of margin landed at scrollY 1980, 200px of margin
 * on the exact same target landed at scrollY 1800, less travel as the
 * margin grows. "The destination should sit lower on the page" means a
 * SMALLER value here (or, as above, a small trim off the minimum), never
 * a larger one.
 *
 * The 36px trim below is a literal, not a variable pulled in from a named
 * constant: Tailwind's class scanner reads this file as plain text to
 * decide which arbitrary-value utilities to generate, and a template
 * literal with an interpolated number produces a class name the scanner
 * can never see as a whole token — the utility silently fails to generate
 * and the trim does nothing at runtime with no error anywhere. Learned by
 * almost shipping exactly that. Change the "36px" by hand if it moves —
 * or, more directly, solve for it as (56 - target landed position).
 */
const REPLAY_TOP_MAT_SCROLL_MT =
  "scroll-mt-[calc(3.5rem_+_env(safe-area-inset-top)_-_36px)] xl:scroll-mt-[env(safe-area-inset-top)]";

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
    Math.min(detail.discarded.length, DISCARD_DRAW_MAX_PER_GROUP) +
    Math.min(detail.drawn.length + unknownDrawn, DISCARD_DRAW_MAX_PER_GROUP);

  // Width budget: mat, less the overlay's own px-2, the one arrow, and the
  // inter-group gaps. Each card also carries an 8%-of-itself gap.
  const widthBudget = matWidth - 16 - 12 - 16;
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
          {/* No "Play" group.
              
              The card that triggered the exchange used to lead the row, back
              when the overlay was the only thing on screen that could say what
              caused it. The move name plate now sweeps in above this overlay
              carrying exactly that — the ability's name, or the Trainer's —
              so repeating it as a card here says the same thing twice and
              costs the two groups that actually matter a third of the width.
              What's left is the transaction itself: what it cost, what it
              bought. `detail.source` is still read for the plate's label. */}
          {reached >= 1 && (
            <DiscardDrawGroup
              key="discard"
              label="Discard"
              cards={detail.discarded}
              width={w}
              dimmed
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
const HAND_STRIP_GAP_PX = 8;
// A chevron button's own width (h-5 w-5 = 20px) plus the gap-1 (4px)
// beside it — same allowance ATTACHED_ROW_CHEVRON_PX spends, kept as its
// own constant since the two rows size against different things (this one
// against matWidth, that one against a card width it's still solving for).
const HAND_STRIP_CHEVRON_PX = 24;

/** Base gap between one card leaving the deck and the next, at 1x. Fast
 *  enough to read as dealing rather than as seven separate draws, slow
 *  enough that the cards are individually countable. Scaled by playback
 *  speed and capped against the beat's own length — see drawStaggerMs. */
const DRAW_STAGGER_MS = 150;

/**
 * The submitting user's hand, anchored directly below their mat — always
 * the bottom mat now that Board pins the player there (see Board's comment
 * on why side/edge stay fixed to visual slot). Every card renders cropped
 * to its top 70% with a gradient fading the cut edge into the page
 * background, rather than showing full cards, so the strip stays short even
 * before the row-count question below comes into it at all.
 *
 * Single row, capped to however many cardWidth-sized cards actually fit
 * under the mat (matWidth), with chevrons — plus native swipe/trackpad
 * scroll, the same two-ways-at-once pattern AttachedCardsRow uses — for a
 * hand that runs past that. Previously this wrapped to as many rows as it
 * needed, which on a seven-plus-card hand pushed the transport controls
 * further down the page every time the hand grew; a fixed one-row height
 * keeps the board's footprint stable regardless of hand size — an empty
 * hand included, which reserves the row rather than collapsing it.
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
  matWidth,
  instant,
  holdFlip,
  onCardClick,
}: {
  cards: HandCard[];
  cardWidth: number;
  /** The mat this strip sits under — what its one-row viewport is sized
   *  against, since cardWidth itself is fixed (inherited from the board)
   *  rather than solved to hit a target column count the way the
   *  inspector's own thumbnail rows are. */
  matWidth: number;
  instant: boolean;
  /**
   * More cards from the same draw are still on their way.
   *
   * Cards arrive face-down and turn over in the hand, but a hand being DEALT
   * should be turned over once it is complete — that is what a player does,
   * and turning each card as it lands makes the deal read as seven unrelated
   * draws instead of one. While this is true, arrivals hold their back; when
   * it goes false they turn over together, in the order they arrived.
   */
  holdFlip: boolean;
  /** Opens the mat-overlay inspector for a tapped card. Omitted (or a
   *  card that isn't `revealed`) means the card isn't clickable — there's
   *  nothing to inspect about a card the log never named. */
  onCardClick?: (target: InspectTarget) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });

  /**
   * Which cards are arriving for the first time, and in what order.
   *
   * A card arrives from the deck face-down and turns over once it is in the
   * hand — so the flip belongs to the moment of arrival, not to any point on
   * the clock. Working it out from the cards themselves keeps that true in
   * every case: the opening seven turn over as a run, a single turn draw turns
   * over on its own, and a card already sitting in the hand never flips again
   * no matter what else changes around it.
   *
   * Recorded in an effect rather than during render. Marking cards seen while
   * rendering would let a double-render retire them before they ever mounted,
   * and the flip they were owed would silently never run.
   */
  const seenRef = useRef<Set<string>>(new Set());
  /**
   * Arrival order, kept for as long as the card is in the hand.
   *
   * It outlives "has this card been seen" on purpose. The flip's stagger is
   * read from it, and the moment a card is marked seen its arrival order
   * would otherwise vanish — changing the delay of an animation that is
   * still running. Entries are pruned when the card leaves the hand, which
   * is the only point at which the order can no longer matter.
   */
  const flipOrderRef = useRef<Map<string, number>>(new Map());
  let arriving = 0;
  for (const card of cards) {
    if (!seenRef.current.has(card.id)) flipOrderRef.current.set(card.id, arriving++);
  }
  const idKey = cards.map((c) => c.id).join(",");
  useEffect(() => {
    const ids = new Set(cards.map((c) => c.id));
    flipOrderRef.current.forEach((_order, id) => {
      if (!ids.has(id)) flipOrderRef.current.delete(id);
    });
    // Held back while the rest of the deal is still in the air: a card marked
    // seen has nothing left to reveal, and marking the first of seven seen
    // would strand it face-up while its six siblings were still coming.
    if (holdFlip) return;
    seenRef.current = ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey, holdFlip]);

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
    // The hand's contents change every step/scrub, not just its count —
    // scrollWidth can shift even between two frames with the same number
    // of cards reflowed differently, so re-measure on every card identity
    // change rather than gating on length alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards.map((c) => c.id).join(","), cardWidth, matWidth]);

  const cardHeight = Math.round((cardWidth * 342) / 245);
  const visibleHeight = Math.round((cardHeight * HAND_STRIP_VISIBLE_PCT) / 100);

  // An empty hand still holds its place. The strip's height is a pure
  // function of cardWidth — the gap above it plus one cropped card — so it
  // can be reserved before there's a card to put in it, and it has to be:
  // returning null here made the board a strip shorter than it would be one
  // draw later, so the first card drawn grew the whole column and shoved
  // the transport controls down the page mid-playback. Only the space is
  // reserved, never anything visible: no chevrons, no scroll container, no
  // border, and aria-hidden so a purely geometric box stays out of the
  // accessibility tree.
  if (cards.length === 0) {
    return (
      <div
        aria-hidden
        className="pointer-events-none"
        style={{ marginTop: HAND_STRIP_TOP_GAP_PX, height: visibleHeight }}
      />
    );
  }

  // How many cards actually fit in one row under the mat: n*cardWidth +
  // (n-1)*gap <= available, solved for n and floored — at least 1, so a
  // single oversized card never disappears entirely on a narrow mat.
  const availableWidth = matWidth - 2 * HAND_STRIP_CHEVRON_PX;
  const maxVisible = Math.max(
    1,
    Math.floor((availableWidth + HAND_STRIP_GAP_PX) / (cardWidth + HAND_STRIP_GAP_PX)),
  );
  const shown = Math.min(cards.length, maxVisible);
  const viewportWidth = shown * cardWidth + (shown - 1) * HAND_STRIP_GAP_PX;

  const step = cardWidth + HAND_STRIP_GAP_PX;
  function scrollByCard(dir: 1 | -1) {
    scrollRef.current?.scrollBy({ left: dir * step, behavior: "smooth" });
  }

  return (
    <div
      className="flex items-center justify-center gap-1"
      style={{ marginTop: HAND_STRIP_TOP_GAP_PX }}
    >
      <AttachedRowChevron
        direction="left"
        visible={overflow.left}
        onClick={() => scrollByCard(-1)}
        label="hand"
      />
      <div
        ref={scrollRef}
        onScroll={updateOverflow}
        className="flex items-start overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ width: viewportWidth, gap: HAND_STRIP_GAP_PX, scrollSnapType: "x proximity" }}
      >
        <AnimatePresence initial={false}>
          {cards.map((card, index) => {
            const clickable = card.revealed && onCardClick != null;
            const flipsOnArrival =
              !instant && card.revealed && flipOrderRef.current.has(card.id);
            return (
            <motion.div
              key={card.id}
              layout
              // Shared with the card in flight from the deck (see DrawFlight).
              // The drawn card does not get replaced by a hand card when it
              // arrives — it BECOMES this element, animating from wherever it
              // was hovering over the mat into its slot in the hand, resizing
              // into the cropped strip on the way. Without the shared id there
              // are two separate cards and a handoff to disguise; with it
              // there is one card that moves.
              layoutId={`hand-${card.id}`}
              // No drop shadow: it would sit below the card's cropped edge,
              // right where the gradient is trying to fade the card into
              // the background — a shadow there reads as a hard edge under
              // the fade, contradicting it.
              className={`relative shrink-0 overflow-hidden rounded ${clickable ? "cursor-pointer" : ""}`}
              style={{ width: cardWidth, height: visibleHeight, scrollSnapAlign: "start" }}
              // A card arriving from the deck must NOT fade in: it is already
              // on screen, standing upright over the draw pile, and this
              // element is that same card continuing its move. Fading it up
              // from nothing is the one thing that would give the handoff
              // away. Cards that appear in the hand by some other route — a
              // scrub, a card returned from play — still fade.
              initial={
                flipOrderRef.current.has(card.id)
                  ? { opacity: 1, y: 0 }
                  : { opacity: 0, y: -8 }
              }
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
              {/* A real two-sided card, turned over in place.
                  
                  The flip lives on an inner element so the outer one is free
                  to run its layout / layoutId animation: both drive the same
                  `transform`, and sharing an element makes the arrival from
                  the deck and the turn-over fight each other.
                  
                  Both faces are always rendered, the back pre-rotated behind
                  the front, and backface-visibility hides whichever is facing
                  away. That is what makes it a card being turned rather than
                  an image being swapped at the halfway point — there is no
                  moment where the wrong side is briefly visible. */}
              <motion.div
                className="absolute inset-0"
                style={{
                  transformStyle: "preserve-3d",
                  transformPerspective: Math.max(600, cardWidth * 9),
                }}
                // Starts showing its back and turns over, but only on the
                // render it first appears — a card already in the hand has
                // nothing to reveal, and one the log never named has no face
                // to turn to.
                initial={{ rotateY: flipsOnArrival ? 180 : 0 }}
                // Stays face-down until the rest of its draw has landed, then
                // turns over. For a single-card draw the two are the same
                // moment and it flips on arrival, as before.
                animate={{ rotateY: flipsOnArrival && holdFlip ? 180 : 0 }}
                transition={{
                  duration: instant ? 0 : 0.45,
                  ease: [0.4, 0, 0.2, 1],
                  // Long enough to land first, then turned over in a run
                  // rather than as one block.
                  delay: flipsOnArrival
                    ? 0.08 + (flipOrderRef.current.get(card.id) ?? 0) * 0.06
                    : 0,
                }}
              >
                {/* Front. The image renders at the card's FULL height inside a
                    wrapper cropped to visibleHeight — top-anchored, so it's
                    the bottom that's cut off rather than the top. */}
                <div
                  className="absolute inset-0 overflow-hidden rounded"
                  style={{ backfaceVisibility: "hidden" }}
                >
                  {card.revealed ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={card.imageUrl ?? undefined}
                      alt={card.name}
                      className="absolute inset-x-0 top-0 w-full object-cover"
                      style={{ height: cardHeight }}
                    />
                  ) : (
                    // A card the log never named. It wears the deck's back for
                    // good, rather than the printed Pokémon one.
                    <CardSleeve radius={4} />
                  )}
                  {card.revealed && !card.imageUrl && (
                    // Catalog miss on a revealed card — same treatment as the
                    // overlay cards: show the name rather than nothing.
                    <div className="absolute inset-0 flex items-center justify-center bg-white p-1 text-center text-[8px] font-semibold leading-tight text-black">
                      {card.name}
                    </div>
                  )}
                </div>
                {/* Back. */}
                <div
                  className="absolute inset-0 overflow-hidden rounded"
                  style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
                  aria-hidden
                >
                  <CardSleeve radius={4} />
                </div>
              </motion.div>
              {/* Fades the cropped edge into the page background instead of
                  ending the card on a hard cut line — the same "peeking
                  content, gradient into var(--bg)" treatment the desktop
                  thread uses at its own scroll edges. */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-1/2 bg-gradient-to-b from-transparent to-[var(--bg)]" />
            </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      <AttachedRowChevron
        direction="right"
        visible={overflow.right}
        onClick={() => scrollByCard(1)}
        label="hand"
      />
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
      <AttachedRowChevron direction="left" visible={overflow.left} onClick={() => scrollByCard(-1)} label="attached cards" />
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
      <AttachedRowChevron direction="right" visible={overflow.right} onClick={() => scrollByCard(1)} label="attached cards" />
    </div>
  );
}

/** Shared by every single-row scrollable card strip (attached cards, the
 *  hand strip) — `label` is the row's own name ("attached cards", "hand"),
 *  finished off into "Scroll {label} left/right" for the accessible name. */
function AttachedRowChevron({
  direction,
  visible,
  onClick,
  label,
}: {
  direction: "left" | "right";
  /** There's nothing that way to scroll to. Kept mounted rather than
   *  unmounted so the row's own width never shifts as the user scrolls
   *  between having and not having room left in a given direction. */
  visible: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!visible}
      aria-label={`Scroll ${label} ${direction}`}
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
      // Fixed white rather than text-primary: both callers now always sit
      // on INSPECTOR_OVERLAY_GRADIENT_BG's dark backdrop, so there's no
      // light-background case left for a theme-tracking color to earn its
      // keep against — white reads clearly on the gradient in either theme.
      className="absolute left-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-white text-white transition hover:bg-white/10"
    >
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}

// The dark-to-transparent fade every full-mat inspector overlay (the card
// inspector, the discard-pile grid) uses as its own background — replacing
// the flat color-mix scrim the discard/draw and mulligan overlays still use.
// It's the overlay's backdrop now, not a panel scoped to whichever card row
// happens to sit on top of it, so a card row rendered over it (the attached-
// cards row) needs no background of its own — see MatCardInspector.
//
// Five stops rather than a single fade-to-transparent: a flat 0.4 dim
// across the upper two-thirds (top, 75%, 50%) keeps the mat/card art behind
// it legible up there, then ramps through 0.6 (25%) to 0.8 at the very
// bottom edge, where the card row/grid actually sits and needs the most
// contrast to read against whatever's behind it.
const INSPECTOR_OVERLAY_GRADIENT_BG =
  "linear-gradient(to top, rgba(0,0,0,0.8), rgba(0,0,0,0.6), rgba(0,0,0,0.4), rgba(0,0,0,0.4), rgba(0,0,0,0.4))";

/** A card sized to fit a mat on both axes — the inspector's own big card,
 *  and the reference size every smaller thumbnail row (attached cards,
 *  the discard pile grid) scales off of. 32px reserves breathing room from
 *  the mat edges on every side. */
function fitCardToMat(matWidth: number): { w: number; h: number } {
  const heightBudget = matWidth * MAT_ASPECT - 32;
  const fromWidth = matWidth - 32;
  const fromHeight = (heightBudget * 245) / 342;
  const w = Math.max(OVERLAY_CARD_MIN_PX, Math.round(Math.min(fromWidth, fromHeight)));
  const h = Math.round((w * 342) / 245);
  return { w, h };
}

/**
 * The small-thumbnail width used by both the card inspector's attached-cards
 * row and the discard-pile grid — one shared formula so a thumbnail reads as
 * the same size everywhere it shows up, rather than each overlay solving its
 * own size independently and drifting apart. Sized off `fitCardToMat`'s big
 * card (ATTACHED_ROW_PCT of its height) since that's the one fixed reference
 * point every overlay on a given mat shares, regardless of whether that
 * overlay actually renders a big card of its own (the discard pile doesn't).
 */
function attachedScaleCardWidth(matWidth: number): number {
  const { h: primaryH } = fitCardToMat(matWidth);
  const attachedH = Math.round((primaryH * ATTACHED_ROW_PCT) / 100);
  // Clamped against the mat's width too, not just the card's height: at up
  // to ATTACHED_ROW_MAX_VISIBLE cards wide plus a chevron on each side, the
  // row's own natural (33%-of-card-height) size could ask for more width
  // than a narrow mat has — and unlike the vertical floor below, a chevron
  // pushed outside the mat isn't just clipped by the mat's overflow-hidden,
  // it's clipped UNREACHABLE, since it's what the user would tap to see the
  // rest. ATTACHED_ROW_CHEVRON_PX is that button's own width plus its gap
  // to the strip, counted on both sides. The discard-pile grid has no
  // chevrons of its own, but shares this same width anyway — the point is
  // for the two thumbnail sizes to match, not for this clamp to describe
  // the grid's own layout.
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
  return Math.max(
    OVERLAY_CARD_MIN_PX,
    Math.round(Math.min((attachedH * 245) / 342, attachedWFromMat)),
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
 * whatever it overlaps rather than sharing space with the card. Legibility
 * against whatever's behind the row (mat or card art alike) comes from the
 * overlay's own INSPECTOR_OVERLAY_GRADIENT_BG background now, not a scrim
 * scoped to the row itself.
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
  // as the discard/draw and mulligan overlays' card sizing. Unaffected by
  // attachedCards — the row below overlays the card rather than sharing
  // its footprint, so there's nothing extra to budget for here.
  const { w } = fitCardToMat(matWidth);
  const attachedW = attachedScaleCardWidth(matWidth);

  return (
    <motion.div
      className="absolute inset-0 z-40 flex items-center justify-center overflow-hidden rounded-xl px-2"
      style={{ backgroundImage: INSPECTOR_OVERLAY_GRADIENT_BG }}
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
        // happen to overlap. No background of its own — the overlay's
        // INSPECTOR_OVERLAY_GRADIENT_BG behind everything already provides
        // the legibility a per-row scrim used to. Not pointer-events-none
        // like the rest of this overlay's decoration: the row is
        // interactive now (scroll, chevrons), so it has to actually
        // receive the taps/swipes aimed at it rather than passing them
        // through to the card underneath — it's a sibling of the card
        // button, not nested inside it, so this can't accidentally
        // trigger the card's own onExpand.
        <div className="absolute inset-x-0 bottom-0 z-10 flex justify-center px-2 pb-3">
          <AttachedCardsRow cards={attachedCards} cardWidth={attachedW} />
        </div>
      )}
    </motion.div>
  );
}

// Grid geometry for the discard-pile inspector. Fixed at 7 columns per the
// request, at the same thumbnail size the card inspector's attached-cards
// row uses (see attachedScaleCardWidth) rather than a size solved to fit
// exactly 7×4 into the mat — 4 rows is just the TARGET visible window
// height at that shared size, clamped to whatever the mat actually has room
// for; either way, a pile beyond what's visible (28 cards at the target, or
// fewer on a mat too short to fit even that) scrolls vertically inside the
// grid rather than growing the overlay or shrinking the cards to fit.
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
  // Same thumbnail size the card inspector's attached-cards row uses, so a
  // card reads as the same size wherever it shows up rather than each
  // overlay solving its own size independently.
  const w = attachedScaleCardWidth(matWidth);
  const cardH = Math.round((w * 342) / 245);
  const rowWidth = DISCARD_GRID_COLS * w + (DISCARD_GRID_COLS - 1) * DISCARD_GRID_GAP_PX;
  // Target DISCARD_GRID_VISIBLE_ROWS tall, but never more height than the
  // mat actually has above the close button and caption — at this shared
  // (not solved-to-fit) thumbnail size, a 4-row target can ask for more
  // than a short mat has room for, and without this clamp it would get cut
  // off by the overlay's own overflow-hidden instead of scrolling the way
  // a genuinely oversized pile (28+ cards) already does.
  const targetVisibleHeight =
    DISCARD_GRID_VISIBLE_ROWS * cardH + (DISCARD_GRID_VISIBLE_ROWS - 1) * DISCARD_GRID_GAP_PX;
  const gridVisibleHeight = Math.min(targetVisibleHeight, matHeight - 56);

  return (
    <motion.div
      className="absolute inset-0 z-40 flex items-center justify-center overflow-hidden rounded-xl px-2"
      style={{ backgroundImage: INSPECTOR_OVERLAY_GRADIENT_BG }}
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
        {/* The only scrolling surface in this overlay — a pile past what
            fits vertically scrolls here instead of growing the grid past
            the mat or shrinking the cards further.

            Flex-wrap rather than CSS grid: a grid auto-places every row
            starting from its left edge regardless of how many cells that
            row has, so a partial bottom row (a pile that isn't a multiple
            of DISCARD_GRID_COLS) reads left-aligned. justify-center on a
            wrapping flex row centers each row independently instead — a
            full row already spans rowWidth edge to edge so centering does
            nothing to it, but a short last row centers within the same
            width rather than hugging the left side. */}
        <div
          className="flex flex-wrap justify-center overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{
            gap: DISCARD_GRID_GAP_PX,
            width: rowWidth,
            maxHeight: gridVisibleHeight,
          }}
        >
          {cards.map((c, i) => (
            <div key={`${c.name}-${i}`} className="shrink-0">
              <OverlayCardThumb card={c} width={w} />
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

/**
 * A side's discard pile, minus the Trainer still sitting on the mat.
 *
 * A played Trainer is in the discard the instant its action resolves — the
 * engine has nowhere else to put it — but the board deliberately keeps showing
 * it floating beside the Active Pokémon for that frame, which is where it
 * physically is. So the card was on screen twice: face-up on the mat, and
 * again as the top of the discard pile it had not visibly travelled to yet.
 *
 * Matched by name against the top of the pile rather than assumed. The engine
 * pushes the Trainer last within its own action, so it IS the top card — but a
 * name check costs nothing and fails safe: an unexpected pile order hides
 * nothing rather than hiding the wrong card.
 */
function discardExcludingFloatingTrainer(
  side: SideFrame | null,
  floating: { name: string } | null,
) {
  if (!side) return { count: 0, top: null, topImageUrl: null, pile: [] };
  if (!floating || side.discard[0]?.name !== floating.name) {
    return {
      count: side.discardCount,
      top: side.discardTop,
      topImageUrl: side.discardTopImageUrl,
      pile: side.discard,
    };
  }
  const rest = side.discard.slice(1);
  return {
    count: Math.max(0, side.discardCount - 1),
    top: rest[0]?.name ?? null,
    topImageUrl: rest[0]?.imageUrl ?? null,
    pile: rest,
  };
}

function Board({
  frame,
  loading,
  error,
  heightBudget,
  instant,
  beat,
  beatPhase,
  drawStaggerMs,
  reducedMotion,
  anyInspectorOpen,
  actionContinues,
  playerMatGradient,
  opponentMatGradient,
  matInspect,
  discardInspect,
  inspect,
  onOpenMatInspect,
  onCloseMatInspect,
  onOpenDiscardInspect,
  onCloseDiscardInspect,
  onExpandInspect,
  onCloseInspect,
}: {
  frame: ReplayFrame | null;
  loading: boolean;
  error: string | null;
  /** Skip card layout animations because the playhead jumped rather than
   *  stepped — see the `instant` state in ReplayViewer. */
  instant: boolean;
  /** The beat being performed over this frame, and how far through it the
   *  director has got. Surfaced on the board root as data attributes so
   *  motion, FX and camera work can hook them from CSS or a descendant
   *  without every layer threading its own props down through BoardKit. */
  beat: Beat | null;
  beatPhase: BeatPhase;
  /** Real milliseconds between two cards leaving the deck — see the viewer,
   *  which solves it against the beat's length and the playback speed. */
  drawStaggerMs: number;
  /** Suppresses the camera: see its `enabled` argument. */
  anyInspectorOpen: boolean;
  /** The frame after this one belongs to the same action — an expanded
   *  discard-then-draw exchange mid-flight. Overlays that describe the
   *  ACTION rather than the frame use it to stay put across the seam. */
  actionContinues: boolean;
  /** The viewer honours prefers-reduced-motion — every card rests, the
   *  pointer tilt is off, and the idle breathing stops. Resolved once in
   *  ReplayViewer2 and handed down rather than queried per card. */
  reducedMotion: boolean;
  /** When set (desktop, thread+board forming a 16:9 rect), the mat width
   *  is derived from this height budget instead of measured from an
   *  ambient container width — see BOARD_VERTICAL_CHROME_PX. Null falls
   *  back to the original measure-the-container behavior (mobile). */
  heightBudget: number | null;
  /** CSS gradient for each side's mat, keyed to that deck's hero Pokémon
   *  energy type — resolved once in ReplayViewer from the loaded payload's
   *  playerPrimaryName/opponentPrimaryName rather than per-frame. */
  playerMatGradient: string;
  opponentMatGradient: string;
  /** Stage 1 (per mat): what the mat-overlay card inspector is showing over
   *  each mat, if anything. Both mats can hold one at once — see
   *  ReplayViewer, which owns this (and everything else inspector-related)
   *  so a keyboard Escape or hitting Play can dismiss every open inspector
   *  in one place regardless of which mat(s) opened them. */
  matInspect: Record<"player" | "opponent", InspectTarget | null>;
  /** Discard-pile inspector open state per mat — a separate slot from
   *  matInspect rather than a third InspectTarget kind, see
   *  DiscardPileOverlay's own comment. */
  discardInspect: Record<"player" | "opponent", boolean>;
  /** Stage 2: the existing full-screen viewer. Global rather than per-mat
   *  — it covers the whole screen, so only one can make sense at a time —
   *  reachable by tapping the card again inside stage 1 (see onExpandInspect). */
  inspect: InspectTarget | null;
  onOpenMatInspect: (actor: "player" | "opponent", target: InspectTarget) => void;
  onCloseMatInspect: (actor: "player" | "opponent") => void;
  onOpenDiscardInspect: (actor: "player" | "opponent") => void;
  onCloseDiscardInspect: (actor: "player" | "opponent") => void;
  onExpandInspect: (actor: "player" | "opponent", target: InspectTarget) => void;
  onCloseInspect: () => void;
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

  // Anything the current beat is about pulls the board toward it. The
  // container measured here is the mats stack, not the outer column, so the
  // camera's offsets are a fraction of the board rather than of the page.
  const stageRef = useRef<HTMLDivElement>(null);
  const camera = useCamera({
    containerRef: stageRef,
    phase: beatPhase,
    actionIndex: frame?.actionIndex ?? null,
    reducedMotion,
    // An open inspector means the viewer is reading the board rather than
    // watching it; a board that leans and jolts underneath a card they are
    // trying to study is actively unhelpful.
    enabled: !anyInspectorOpen,
  });

  // The Trainer floating on each mat, if any — used to keep it out of that
  // side's discard pile until it has visibly left the mat.
  // Cards still in the air on their way to the hand.
  //
  // A drawn card is in the frame's hand from the instant its action resolves,
  // so the hand strip was already showing what the flight was still carrying —
  // the same card in two places, which is the whole thing this is fixing. The
  // hand holds the trailing N back until DrawFlight reports them landed, and
  // the two swap in one render.
  //
  // Only the player's, because only the player's hand is on screen; the
  // opponent's cards fly up and out of frame with nothing to hand off to.
  const [landed, setLanded] = useState<{ action: number; count: number }>({
    action: -1,
    count: 0,
  });
  const [startedAction, setStartedAction] = useState<number | null>(null);
  const drawnInFlight = (() => {
    if (instant || reducedMotion || !beat || beat.actor !== "player") return 0;
    // Gated on a flight having actually started, not merely on the beat being
    // a draw: if the flight never got off the ground, the hand must show the
    // cards rather than hide what nothing is carrying.
    if (startedAction !== beat.actionIndex) return 0;
    const flight = drawFlightFor(beat);
    if (!flight) return 0;
    // Cards are dealt one at a time, so they are un-hidden one at a time.
    // The engine pushes drawn cards onto the END of the hand in order, so
    // hiding the trailing N reveals exactly the ones already dealt.
    const released = landed.action === beat.actionIndex ? landed.count : 0;
    return Math.max(0, flight.count - released);
  })();
  const visibleHand = frame
    ? frame.player.hand.slice(0, Math.max(0, frame.player.hand.length - drawnInFlight))
    : [];

  const opponentDiscard = discardExcludingFloatingTrainer(
    frame?.opponent ?? null,
    frame?.lastPlayedTrainer?.actor === "opponent" ? frame.lastPlayedTrainer : null,
  );
  const playerDiscard = discardExcludingFloatingTrainer(
    frame?.player ?? null,
    frame?.lastPlayedTrainer?.actor === "player" ? frame.lastPlayedTrainer : null,
  );

  const matWidth =
    heightBudget != null
      ? Math.max(20, (heightBudget - BOARD_VERTICAL_CHROME_PX) / (2 * MAT_ASPECT))
      : measuredWidth;

  const cardWidth = computeReplayCardWidth(matWidth);

  return (
    <BeatProvider
      beat={beat}
      phase={beatPhase}
      instant={instant}
      reducedMotion={reducedMotion}
    >
    <div
      ref={matContainerRef}
      className="mt-4"
      data-beat-kind={beat?.kind ?? "none"}
      data-beat-actor={beat?.actor ?? "none"}
      data-beat-weight={beat?.weight ?? "none"}
      data-beat-phase={beatPhase}
      style={heightBudget != null ? { width: matWidth } : undefined}
    >
      {error ? (
        <div className="rounded-2xl border border-accent/40 bg-white p-6 text-sm text-accent">
          {error}
        </div>
      ) : !frame ? (
        <div className="rounded-2xl border border-black/8 bg-white p-10 text-center text-sm text-text-secondary">
          {loading ? "Loading replay…" : "Pick a battle below to begin."}
        </div>
      ) : (
        <>
        {/* Camera stage. The transform lives on a wrapper around the mats so
            the mats' own layout — which every geometry calculation in
            BoardKit depends on — is untouched by it. The FX canvas sits
            inside the same wrapper so bursts travel with the board they were
            emitted onto. */}
        <motion.div
          ref={stageRef}
          className="relative"
          style={{ transformOrigin: "center center" }}
          animate={{
            scale: camera.scale,
            // The jolt rides on top of the lean, as keyframes returning to
            // the camera's current offset rather than to zero — otherwise a
            // shake during a push-in yanks the board back to centre.
            x: camera.shake
              ? [camera.x, camera.x - 9, camera.x + 7, camera.x - 4, camera.x]
              : camera.x,
            y: camera.shake
              ? [camera.y, camera.y + 5, camera.y - 4, camera.y + 2, camera.y]
              : camera.y,
          }}
          transition={
            camera.shake
              ? { duration: 0.32, ease: "easeOut" }
              : { type: "spring", stiffness: 150, damping: 26, mass: 1.1 }
          }
        >
        <FxCanvas reducedMotion={reducedMotion} />
        {/* Cards leaving the deck. Below the name plate, above the mats. */}
        <DrawFlight
          beat={beat}
          frame={frame}
          reducedMotion={reducedMotion}
          staggerMs={drawStaggerMs}
          onLanded={(action, count) => setLanded({ action, count })}
          onStarted={setStartedAction}
        />
        {/* Above the particles: the plate names what caused them. */}
        <MoveNamePlate
          beat={beat}
          phase={beatPhase}
          actionContinues={actionContinues}
          // A discard-then-draw or a mulligan reveal fills the middle of that
          // player's mat, which is exactly where the plate sits.
          exchangeActor={frame?.discardDraw?.actor ?? frame?.mulligan?.actor ?? null}
          reducedMotion={reducedMotion}
        />
        {/* Above the canvas: the flourish is the subject at that moment, not
            something for particles to be drawn over. The board pins the
            opponent to the top mat and the submitting player to the bottom,
            so the winner's actor maps straight onto an edge. */}
        <GameEndFlourish
          beat={beat}
          phase={beatPhase}
          reducedMotion={reducedMotion}
          winnerEdge={
            beat?.kind === "game_end" && beat.winner != null
              ? beat.winner === "player"
                ? "bottom"
                : "top"
              : null
          }
          winnerName={
            beat?.kind === "game_end" && beat.winner != null
              ? (beat.winner === "player"
                  ? frame?.player.handle
                  : frame?.opponent.handle) ?? null
              : null
          }
        />
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
            value={(target) => onOpenMatInspect("opponent", target)}
          >
          <div
            id={REPLAY_TOP_MAT_ID}
            className={`relative z-10 ${REPLAY_TOP_MAT_SCROLL_MT}`}
          >
            <PlayerMat
              side="player"
              bench={frame.opponent.bench}
              active={frame.opponent.active}
              discardCount={opponentDiscard.count}
              discardTop={opponentDiscard.top}
              discardTopImageUrl={opponentDiscard.topImageUrl}
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
              actor="opponent"
              matGradient={opponentMatGradient}
              onDiscardClick={() => onOpenDiscardInspect("opponent")}
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
              {matInspect.opponent && (
                <MatCardInspector
                  target={matInspect.opponent}
                  cardWidth={cardWidth}
                  matWidth={matWidth}
                  onExpand={() => onExpandInspect("opponent", matInspect.opponent!)}
                  onClose={() => onCloseMatInspect("opponent")}
                />
              )}
            </AnimatePresence>
            <AnimatePresence>
              {discardInspect.opponent && (
                <DiscardPileOverlay
                  cards={opponentDiscard.pile}
                  matWidth={matWidth}
                  onClose={() => onCloseDiscardInspect("opponent")}
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
            value={(target) => onOpenMatInspect("player", target)}
          >
          <div className="relative z-10">
            <PlayerMat
              side="opponent"
              bench={frame.player.bench}
              active={frame.player.active}
              discardCount={playerDiscard.count}
              discardTop={playerDiscard.top}
              discardTopImageUrl={playerDiscard.topImageUrl}
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
              actor="player"
              matGradient={playerMatGradient}
              onDiscardClick={() => onOpenDiscardInspect("player")}
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
              {matInspect.player && (
                <MatCardInspector
                  target={matInspect.player}
                  cardWidth={cardWidth}
                  matWidth={matWidth}
                  onExpand={() => onExpandInspect("player", matInspect.player!)}
                  onClose={() => onCloseMatInspect("player")}
                />
              )}
            </AnimatePresence>
            <AnimatePresence>
              {discardInspect.player && (
                <DiscardPileOverlay
                  cards={playerDiscard.pile}
                  matWidth={matWidth}
                  onClose={() => onCloseDiscardInspect("player")}
                />
              )}
            </AnimatePresence>
          </div>
          </InspectContext.Provider>
        </div>
        </motion.div>
        {/* Player's hand, always the bottom mat's now that the swap above
            pins the submitting user there — see HandStrip. Cards open
            through the same mat-overlay inspector as the mat itself,
            always on the player's (bottom) mat, since a hand card is
            always the player's own. */}
        <HandStrip
          cards={visibleHand}
          cardWidth={cardWidth}
          matWidth={matWidth}
          instant={instant}
          holdFlip={drawnInFlight > 0}
          onCardClick={(target) => onOpenMatInspect("player", target)}
        />
        </>
      )}
      {inspect && (
        <ReplayCardInspector target={inspect} onClose={onCloseInspect} />
      )}
    </div>
    </BeatProvider>
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
          steppers hold a fixed spread.

          sm:hidden rather than a desktop-only condition: mobile is the
          narrow viewport where the turn stepper's own label is easy to
          lose track of one-handed, and this line is the cheap reminder;
          from sm: up there's more room to actually watch the scrubber and
          the readout stops earning its keep. Matches this component's own
          sm: breakpoint (the control row below switches its spacing at
          the same point) rather than the site chrome's xl:. */}
      <div className="mt-4 sm:hidden text-center text-[10px] tabular-nums text-text-muted">
        {turnLabel}
      </div>

      {/* Control row: capsules flank the play button and nothing else lives
          here, so items-center puts them on its midline by construction.
          Padding and the gap both step up at sm: — below that, the two
          capsules at their full spread ran past a phone's content width
          (~343px at 375px viewport) and forced the row to overflow rather
          than wrap, since nothing here is allowed to shrink onto a second
          line.

          mt-1.5 sm:mt-8: the turn-label line above is display:none from
          sm: up, which takes its own mt-4 and its line's height of
          spacing with it — measured at ~33px total (mt-4 + a 10px line +
          mt-1.5), so sm:mt-8 (32px, the closest step on the scale) stands
          in for that gap directly on this row, and the scrubber and the
          control row don't end up crowded together once the label
          between them disappears. */}
      <div className="mt-1.5 sm:mt-8 flex items-center justify-center gap-1.5 sm:gap-3">
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
  /** Identifies the battle to BattleLogDetail (its fetch/reset key). */
  battleId: string;
  /** GET endpoint returning a ReplayPayload for this battle. */
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
  /** Drop the mobile action thread, leaving just the board and transport.
   *  Desktop is unaffected — its thread lives in a height-capped aside, so
   *  it costs no extra page length. The mobile thread instead renders in
   *  full and is scrolled by the page itself, which is right on a dedicated
   *  battle page but would bury everything below it when the viewer is one
   *  module among many (see the home page showcase). */
  hideThreadOnMobile?: boolean;
  /** Start playing as soon as the replay loads, instead of parked on frame
   *  0 waiting for Play. For a viewer embedded in a scrolling page (the home
   *  page showcase) rather than one the visitor deliberately navigated to,
   *  arriving mid-action reads as "a battle is already underway" instead of
   *  a static board that needs a click to prove it's interactive. */
  autoPlay?: boolean;
  /** Playback speed autoPlay starts at. Independent of autoPlay so a caller
   *  could set one without the other, though today only the showcase sets
   *  either. Still just the initial value — the speed picker remains live,
   *  so a viewer can slow back down once they've engaged with it. */
  initialSpeed?: 0.5 | 1 | 2 | 4;
}

export default function ReplayViewer({
  battleId,
  replayUrl,
  logUrl,
  renderHeader,
  result,
  playerColor,
  opponentColor,
  hideThreadOnMobile = false,
  autoPlay = false,
  initialSpeed = 1,
}: ReplayViewerProps) {
  const [data, setData] = useState<ReplayPayload2 | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2 | 4>(initialSpeed);
  // Read inside the load effect via ref rather than listed as a dependency:
  // autoPlay isn't a reason to re-fetch replayUrl, just data the effect
  // consults once the fetch it's already doing resolves.
  const autoPlayRef = useRef(autoPlay);
  autoPlayRef.current = autoPlay;
  // True when the pending frame change is a *jump* (scrub, turn skip, battle
  // load) rather than a single step. Board/bench layout animations model a
  // card physically moving between slots, which is only meaningful one
  // action at a time — across a jump they animate cards along routes the
  // game never took, and a fast drag leaves them mid-flight. Jumps therefore
  // cut straight to the destination state.
  const [instant, setInstant] = useState(false);
  // Board's card inspectors, lifted up here (rather than owned by Board
  // itself) so playback and a keyboard Escape can reach every one of them
  // regardless of which mat opened it. Both mats can hold a stage-1
  // mat-overlay inspector at once — matInspect/discardInspect are keyed
  // per actor rather than a single "whichever mat asked last" slot. Stage
  // 2 (the full-screen viewer) stays a single global slot since it covers
  // the whole screen and only one can make sense at a time.
  const [matInspect, setMatInspect] = useState<
    Record<"player" | "opponent", InspectTarget | null>
  >({ player: null, opponent: null });
  const [discardInspect, setDiscardInspect] = useState<
    Record<"player" | "opponent", boolean>
  >({ player: false, opponent: false });
  const [inspect, setInspect] = useState<InspectTarget | null>(null);

  const anyInspectorOpen =
    matInspect.player != null ||
    matInspect.opponent != null ||
    discardInspect.player ||
    discardInspect.opponent ||
    inspect != null;

  // Opening any inspector pauses playback — an inspector reads the board at
  // a single frozen frame, and cards would keep advancing underneath it
  // otherwise. Each opener below sets both this mat's inspector state and
  // pauses; closing never resumes on its own (see togglePlay for the one
  // path that does).
  function openMatInspect(actor: "player" | "opponent", target: InspectTarget) {
    setDiscardInspect((d) => ({ ...d, [actor]: false }));
    setMatInspect((m) => ({ ...m, [actor]: target }));
    setPlaying(false);
  }
  function closeMatInspect(actor: "player" | "opponent") {
    setMatInspect((m) => ({ ...m, [actor]: null }));
  }
  function openDiscardInspect(actor: "player" | "opponent") {
    setMatInspect((m) => ({ ...m, [actor]: null }));
    setDiscardInspect((d) => ({ ...d, [actor]: true }));
    setPlaying(false);
  }
  function closeDiscardInspect(actor: "player" | "opponent") {
    setDiscardInspect((d) => ({ ...d, [actor]: false }));
  }
  function expandInspect(actor: "player" | "opponent", target: InspectTarget) {
    setInspect(target);
    setMatInspect((m) => ({ ...m, [actor]: null }));
    setPlaying(false);
  }
  function closeAllInspectors() {
    setMatInspect({ player: null, opponent: null });
    setDiscardInspect({ player: false, opponent: false });
    setInspect(null);
  }

  // Keyboard Escape dismisses every open inspector at once, on either mat.
  // Scoped to only attach while something's actually open, so an Escape
  // press aimed at something else (closing a browser find bar, say) doesn't
  // churn this component's state for no reason.
  useEffect(() => {
    if (!anyInspectorOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setMatInspect({ player: null, opponent: null });
      setDiscardInspect({ player: false, opponent: false });
      setInspect(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [anyInspectorOpen]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPlaying(false);
    setMatInspect({ player: null, opponent: null });
    setDiscardInspect({ player: false, opponent: false });
    setInspect(null);
    fetch(replayUrl)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Replay failed (${r.status})`);
        return (await r.json()) as ReplayPayload2;
      })
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setInstant(true);
        setFrameIndex(0);
        // Gated on the payload actually having frames — an empty replay has
        // nothing to play, and the auto-advance effect's own frameCount - 1
        // check would immediately re-pause it anyway, but there's no reason
        // to flip playing on just to flip it back off next tick.
        if (autoPlayRef.current && payload.frames.length > 0) setPlaying(true);
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

  // One gradient per side, resolved once per battle (not per frame — the
  // hero Pokémon is fixed for the whole game).
  const playerMatGradient = useMemo(
    () => matGradientForPrimary(data?.playerPrimaryName ?? null),
    [data?.playerPrimaryName],
  );
  const opponentMatGradient = useMemo(
    () => matGradientForPrimary(data?.opponentPrimaryName ?? null),
    [data?.opponentPrimaryName],
  );

  const frameCount = data?.frames.length ?? 0;
  // Turn numbers are monotonic (0 = setup, then 1, 2, 3… per lib/engine/sim's
  // state.turn.number), so the last frame's is the battle's turn total.
  const totalTurns =
    data && data.frames.length > 0 ? data.frames[data.frames.length - 1].turn : 0;

  // Beats for the loaded battle, keyed by actionIndex. Frames and beats join
  // on that index rather than zipping: a discard-then-draw exchange and a
  // mulligan run each expand into several frames sharing one action.
  const beatByAction = useMemo(() => indexBeats(data?.beats ?? []), [data]);

  const beatAt = useCallback(
    (i: number): Beat | null => {
      const f = data?.frames[i];
      return f ? (beatByAction.get(f.actionIndex) ?? null) : null;
    },
    [data, beatByAction],
  );

  // A frame that repeats its predecessor's actionIndex is a later stage of
  // the same action, not a new one — the director gives it a short
  // continuation beat instead of performing the whole thing again.
  const isContinuation = useCallback(
    (i: number): boolean => {
      const frames = data?.frames;
      if (!frames || i <= 0) return false;
      return frames[i]?.actionIndex === frames[i - 1]?.actionIndex;
    },
    [data],
  );

  // Whether the NEXT frame is a later beat of the action on screen now. An
  // overlay that belongs to the action rather than to the frame — the move
  // name plate — uses this to survive the seam between an exchange's stages
  // instead of exiting and re-entering at each one.
  //
  // Bounds-checked rather than left to isContinuation, which compares two
  // array lookups: past the end of the frame list both are undefined and
  // compare equal, so the last frame of a replay would report that its
  // action carries on and the plate would never leave.
  const actionContinues =
    frameIndex + 1 < frameCount && isContinuation(frameIndex + 1);

  const advance = useCallback(() => {
    setInstant(false);
    setFrameIndex((i) => (i >= frameCount - 1 ? i : i + 1));
  }, [frameCount]);

  // The playback clock. Replaces v1's fixed-interval auto-advance: each frame
  // now holds for as long as its beat has earned, and ticks through that
  // beat's phases while it does. See director/choreography.ts.
  const {
    phase: beatPhase,
    beat: currentBeat,
    spec: currentSpec,
  } = useDirector({
    beatAt,
    isContinuation,
    frameIndex,
    frameCount,
    playing,
    speed,
    instant,
    onAdvance: advance,
  });

  /**
   * How long one card waits before the next leaves the deck.
   *
   * Solved here because both inputs live here: the beat's choreographed length
   * and the playback speed. The deal has to finish inside its own beat — a
   * card still on the deck when the frame advances would appear in the hand
   * with no flight to account for it — so the base cadence is capped against
   * the time actually available, which is what keeps a two-card turn draw and
   * a seven-card opening hand both looking dealt at 0.5x and at 4x.
   */
  const drawStaggerMs = (() => {
    const scale = 1 / Math.max(0.1, speed);
    const base = DRAW_STAGGER_MS * scale;
    const flight = drawFlightFor(currentBeat);
    if (!flight) return base;
    // 0.78 rather than the whole beat: the last card still needs its own
    // travel time after it is released.
    const available = (specDuration(currentSpec) * scale * 0.78) / flight.count;
    return Math.min(base, available);
  })();

  // Pause automatically when the last frame is reached.
  useEffect(() => {
    if (playing && frameIndex >= frameCount - 1) setPlaying(false);
  }, [playing, frameIndex, frameCount]);

  const atEnd = frameCount > 0 && frameIndex >= frameCount - 1;

  // Play/pause, plus restart: pressing play while parked on the last frame
  // rewinds to the start and runs again. Both state updates batch into one
  // render, so the auto-pause effect above sees frameIndex 0 alongside
  // playing=true and doesn't immediately stop it. The rewind is a jump, so
  // it cuts rather than animating cards across the whole battle.
  function togglePlay() {
    if (playing) {
      setPlaying(false);
      return;
    }
    // Resuming with an inspector open would leave it showing a frame that's
    // no longer current the instant playback advances — close everything
    // first (same batch of updates as the rewind/play below, so this reads
    // as one click: inspectors close and playback starts together).
    if (anyInspectorOpen) closeAllInspectors();
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

  // Replay 2.0 leans hard on motion — poses, tilt, lifts, an idle breath on
  // the Active. All of it collapses to a still board when the OS asks for
  // reduced motion; the replay still plays, beat pacing and all, it just
  // stops moving cards to say so. Watched live rather than read once, since
  // the setting can be toggled while the page is open.
  //
  // Defaults to false during SSR and the first client tick. That's the right
  // way round: the query resolves before any beat has performed, so a
  // motion-sensitive viewer never sees a frame of movement, and a viewer
  // without the setting never sees the board start out frozen.
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = () => setReducedMotion(mq.matches);
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
  }, [frame?.actionIndex, battleId]);

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
            key={battleId}
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
                battleId={battleId}
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
            beat={currentBeat}
            beatPhase={beatPhase}
            drawStaggerMs={drawStaggerMs}
            reducedMotion={reducedMotion}
            anyInspectorOpen={anyInspectorOpen}
            actionContinues={actionContinues}
            playerMatGradient={playerMatGradient}
            opponentMatGradient={opponentMatGradient}
            matInspect={matInspect}
            discardInspect={discardInspect}
            inspect={inspect}
            onOpenMatInspect={openMatInspect}
            onCloseMatInspect={closeMatInspect}
            onOpenDiscardInspect={openDiscardInspect}
            onCloseDiscardInspect={closeDiscardInspect}
            onExpandInspect={expandInspect}
            onCloseInspect={() => setInspect(null)}
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
      {isDesktop === false && !hideThreadOnMobile && (
        <div className="mt-6">
          <BattleLogDetail
            battleId={battleId}
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
