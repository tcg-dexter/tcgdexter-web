// Replay 2.0's board primitives — a fork of app/admin-tools/replay/BoardKit.
//
// The original is shared by the production battles page, the home-page
// showcase and the AI-player practice mode, so 2.0 copies it rather than
// editing it. Everything below is byte-for-byte the v1 board at the point of
// the fork; 2.0's card material, trajectories and FX hooks land here.
"use client";

// Shared board-rendering kit for the Replay viewer and the AI-player
// practice mode. Extracted verbatim from ReplayClient.tsx so both surfaces
// render the same mats, card holders, piles, prize stacks and inspector.
//
// Interactivity is additive and optional: PokemonCardImage accepts
// onClick/dimmed overrides (play mode's target picking), and PlayerMat
// threads an `interact` bundle down to its cards. With none of those set,
// behavior is exactly the replay board's (tap → card inspector).

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import {
  MAT_STYLES,
  TEXTURES,
  MAT_PADDING,
  MAT_ASPECT,
} from "@/app/admin-tools/deck-mat/DeckMatClient";
import { shade } from "@/lib/color";
import { MatActorContext, useBeat, useMatActor } from "./director/BeatContext";
import {
  CardSurface,
  ClaimContext,
  DamageBurst,
  FoilSheen,
  travelStyle,
  useCardPerformance,
  useClaim,
  usePreviousMatCards,
  useTravelLift,
} from "./card3d/Card3D";
import {
  focusRole,
  resolveClaim,
  type CardRole,
  type MatCards,
} from "./card3d/claim";
import {
  conditionColor,
  emitFocus,
  emitFx,
  emitMovePlate,
  energyColor,
} from "./fx/fxBus";

// Default mat gradient when a caller doesn't resolve one of its own — the
// AI-player practice mode boards (PlayClient.tsx) still use this as-is.
export const BOARD_GRADIENT = MAT_STYLES.find((s) => s.key === "fire-lightning")!.gradient;
const BOARD_TEXTURE = TEXTURES.find((t) => t.key === "lines")!;

export interface PokemonFrame {
  /** Engine instance id — stable across turns, unique per Pokémon in play.
   *  Required: React keys and framer-motion layoutIds derive from it, and
   *  names are NOT unique (three Noctowl on one bench is ordinary). When
   *  this fell back to the name, colliding layoutIds let framer-motion
   *  animate unrelated cards into each other's slots, stranding ghost
   *  cards outside the bench row after a scrub. */
  id: string;
  name: string;
  damage: number;
  hp: number | null;
  energy: string[];
  energyTypes: string[];
  conditions: string[];
  evolutionStack: string[];
  imageUrl: string | null;
  /** Attached Pokémon Tools, rendered behind the card with the title
   *  peeking above. Both surfaces populate this (empty array when the
   *  Pokémon holds none). */
  tools?: { name: string; imageUrl: string | null }[];
  /** Every card attached to this Pokémon — energy then Tools, each
   *  resolved to art — for the replay viewer's card inspector. Optional
   *  like `tools` above: only the replay pipeline (lib/replay/frames.ts)
   *  populates it today: the AI-player practice mode's own PokemonFrame
   *  producer has no inspector row to feed. Treat a missing array the
   *  same as an empty one. */
  attachedCards?: { name: string; imageUrl: string | null }[];
}

// pokemontcg.io serves the standard Pokémon card-back PNG as the body of
// a 404 — browsers render the bytes regardless of status code. Reusing
// that gives us a card-back without bundling an asset of our own.
export const CARD_BACK_URL = "https://images.pokemontcg.io/back.png";

// Card inspector (lightbox) target. A tapped Pokémon opens with its full
// holder — HP bar + attached energies — while any other card (stadium,
// played trainer, top discard) opens as a plain large image.
export type InspectTarget =
  | { kind: "pokemon"; mon: PokemonFrame }
  | { kind: "card"; name: string; imageUrl: string | null };

// Lets any card on the mat open the inspector without prop-drilling a
// callback through PlayerMat → rows → individual cards.
export const InspectContext = createContext<((t: InspectTarget) => void) | null>(null);

/* ──────────────────────────────────────────────────────────────── */
/* Geometry                                                         */
/* ──────────────────────────────────────────────────────────────── */

// Rail columns (draw/discard/prizes) and active card are sized for a standard
// 5-card bench. The bench itself is an absolutely positioned overlay and never
// competes with the grid layout, so only those 5 card-widths + 2 grid gaps
// constrain the formula.
// Tray geometry ratios (×card width). A Pokémon renders inside a rounded
// "card holder": padding around the contents, the card image on top, a gap,
// then a stacked info strip (energy row above, HP bar below). TRAY_TOTAL_RATIO
// is the holder's full height as a multiple of card width — used to reserve
// vertical space so two stacked rows (bench + active) never collide.
const TRAY_PAD_RATIO = 0.045;
const TRAY_GAP_RATIO = 0.04;
const TRAY_STRIP_RATIO = 0.34;
// The holder wraps a full-size card image (same width as the stand-alone
// cards), inset by `pad` on every side — so the container is wider than the
// card image by 2*pad.
export const CONTAINER_W_FACTOR = 1 + 2 * TRAY_PAD_RATIO;
// Holder height as a multiple of the card-image width: top pad + card
// (342/245 tall) + gap + HP strip + bottom pad.
export const TRAY_TOTAL_RATIO =
  2 * TRAY_PAD_RATIO + 342 / 245 + TRAY_GAP_RATIO + TRAY_STRIP_RATIO;
// Card images (and their holders) are rendered 10% larger than the bare
// fit-to-mat size, consuming the layout headroom. The holder geometry scales
// with them, but the footer/label text is pinned to its pre-bump pixel size
// (see the `/ CARD_IMAGE_BUMP` in the font-size computations).
const CARD_IMAGE_BUMP = 1.1;

/** Text size for anything living inside a black card holder (the HP row, the
 *  pile labels, the Active's attack rows). Exported so callers rendering into
 *  a holder match it instead of guessing a px value that drifts on resize. */
export function holderFontSize(cardWidth: number): number {
  return Math.max(6, Math.round((replayTrayMetrics(cardWidth).strip * 0.34) / CARD_IMAGE_BUMP));
}
// Shared gap (px) between adjacent cards on the board: bench-to-bench and the
// float gap between the active and its stadium / played-trainer neighbours.
const BOARD_CARD_GAP = 4;

export function computeReplayCardWidth(matWidth: number): number {
  const innerW = matWidth - 2 * MAT_PADDING;
  const innerH = matWidth * MAT_ASPECT - 2 * MAT_PADDING;
  const ROW_GAP = 6;
  // Two tray rows (bench + active) must fit the mat height; size from the
  // tray's full height, not the bare card.
  const maxTrayH = (innerH - ROW_GAP) / 2;
  const maxWidthFromH = maxTrayH / TRAY_TOTAL_RATIO;
  // Conservative width budget. The bench row (5 holders) is the tightest at
  // 5·CONTAINER_W_FACTOR; the rail row (2 landscape pile holders + the active)
  // is looser. Reserving 7·CONTAINER_W_FACTOR over-estimates both, so the
  // wider rotated-pile rails still fit comfortably.
  const maxWidthFromW =
    (innerW - 2 * 12 - 5 * BOARD_CARD_GAP) / (7 * CONTAINER_W_FACTOR);
  return Math.max(
    20,
    Math.floor(Math.min(maxWidthFromH, maxWidthFromW) * 0.9 * CARD_IMAGE_BUMP),
  );
}

// Resolve the holder's pixel geometry from a card-image width (the same width
// as the stand-alone cards). The card image is inset by `pad` on every side
// for a concentric corner radius, so the container is `width + 2*pad` wide and
// taller by the card height + gap + HP strip + paddings.
export function replayTrayMetrics(width: number) {
  const pad = Math.max(2, Math.round(width * TRAY_PAD_RATIO));
  const gap = Math.max(1, Math.round(width * TRAY_GAP_RATIO));
  const strip = Math.max(12, Math.round(width * TRAY_STRIP_RATIO));
  const cardW = width;
  const cardH = cardW * (342 / 245);
  const containerW = width + 2 * pad;
  const totalH = pad + cardH + gap + strip + pad;
  const radius = Math.max(4, Math.round(containerW * 0.08));
  const cardRadius = Math.max(2, radius - pad);
  return { pad, gap, strip, cardW, cardH, containerW, totalH, radius, cardRadius };
}

// Pile cards are the portrait card turned on its side, at full proportions:
// the long edge (342) runs horizontally while the short edge stays `width`.
// `pileHolderWidth` is the resulting holder width — used both by the pile
// components and by the rail grid columns so they stay in lockstep.
export function pileCardLong(width: number): number {
  return Math.round(width * (342 / 245));
}
export function pileHolderWidth(width: number): number {
  return pileCardLong(width) + 2 * replayTrayMetrics(width).pad;
}

/* ──────────────────────────────────────────────────────────────── */
/* Card faces + piles                                               */
/* ──────────────────────────────────────────────────────────────── */

// Direction a pile's cards are rotated so their printed top points at the
// mat's outer edge: "ccw" for the left rail (top → left), "cw" for the right
// rail (top → right).
export type PileRotate = "cw" | "ccw";

// A single card face turned on its side to fill a landscape `L × H` slot. The
// source art is portrait (245:342), so we render it at `H × L` (still 245:342)
// and rotate ±90° about the center; its bounding box then matches the slot.
function RotatedCardFace({
  src,
  alt,
  L,
  H,
  radius,
  rotate,
  ariaHidden,
}: {
  src: string;
  alt: string;
  L: number;
  H: number;
  radius: number;
  rotate: PileRotate;
  ariaHidden?: boolean;
}) {
  const deg = rotate === "cw" ? 90 : -90;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      aria-hidden={ariaHidden || undefined}
      className="absolute left-1/2 top-1/2 max-w-none object-cover"
      style={{
        width: H,
        height: L,
        transform: `translate(-50%, -50%) rotate(${deg}deg)`,
        borderRadius: radius,
      }}
      onError={(e) => {
        if (e.currentTarget.src !== CARD_BACK_URL) e.currentTarget.src = CARD_BACK_URL;
      }}
    />
  );
}

// The back of a face-down card — what shows on the draw and prize piles.
// Currently a card-shaped rounded rect in the site signature gradient; this is
// the seam where the "card sleeve" becomes customizable later. The shadow
// mirrors the stacked-card shadow in Playmat Studio so layered sleeves read
// with depth. Fills its positioned parent.
export function CardSleeve({ radius, shadow }: { radius: number; shadow?: boolean }) {
  return (
    <div
      className="absolute inset-0"
      style={{
        borderRadius: radius,
        background: "var(--gradient-brand)",
        boxShadow: shadow ? "0 -2px 2px rgba(0,0,0,0.33)" : undefined,
      }}
    />
  );
}

/** How a face-up card renders. "art" (the default, and what both game
 *  surfaces use) shows the card image. "label" replaces the art with the
 *  card's name set as plain text — the Learn to Play board renders the real
 *  mat this way, because a beginner learning where the Active sits is served
 *  by the word "Active", not by a particular Charizard. */
export type CardFace = "art" | "label";

/** The "label" face: a card-shaped slot naming what the card is. Sized off
 *  the card-image width so it scales with the mat like the art it replaces.
 *  Fills its positioned parent, same as CardSleeve. */
export function CardLabelFace({ text, width }: { text: string; width: number }) {
  return (
    <div
      // Deliberately a fixed dark ink, not a theme token: the slot behind it
      // is hard-coded white (that's what card art sits on), so a token that
      // lightens in dark mode would leave white-on-white.
      className="absolute inset-0 flex items-center justify-center px-1 text-center font-bold uppercase leading-tight tracking-wide text-neutral-700"
      style={{ fontSize: Math.max(7, Math.round(width * 0.13)) }}
    >
      {text}
    </div>
  );
}

// Draw / discard pile, in the same black holder as the Pokémon cards, but
// turned on its side so the card's printed top faces the mat's outer edge.
// The card art fills a landscape slot; the footer (label + count) stays
// upright below it, along the now-longer edge.
export function Pile({
  label,
  count,
  width,
  rotate,
  topName,
  topImageUrl,
  hint,
  useCardBack,
  onClick,
  face = "art",
  className = "",
}: {
  label: string;
  count: number;
  /** Card-image width — drives the holder geometry (matches the actives). */
  width: number;
  /** Which way to rotate so the card top points at the mat's outer edge. */
  rotate: PileRotate;
  topName?: string | null;
  /** When set, render the top card face-up using this image (discard). */
  topImageUrl?: string | null;
  hint?: string;
  /** Render the standard card-back image as the face. */
  useCardBack?: boolean;
  /** Overrides the default single-card InspectContext tap (top card only)
   *  with a caller-supplied handler — the Replay viewer's discard pile uses
   *  this to open its full-pile inspector instead. */
  onClick?: () => void;
  /** See CardFace — "label" names the top card instead of showing its art. */
  face?: CardFace;
  className?: string;
}) {
  const inspect = useContext(InspectContext);
  const m = replayTrayMetrics(width);
  const fontSize = Math.max(6, Math.round((m.strip * 0.34) / CARD_IMAGE_BUMP));

  // Piles were the last inert thing on the board: every card that enters or
  // leaves the game passes through one, and they registered it by silently
  // changing a number. `kind` names which pile this is so a beat can pick the
  // one it concerns — a draw pulses the deck, a discard pulses the discard.
  const pileKind: "draw" | "discard" | null =
    label === "Draw" ? "draw" : label === "Discard" ? "discard" : null;
  const { beat, phase, instant, reducedMotion } = useBeat();
  const matActor = useMatActor();
  const pileActive =
    !reducedMotion &&
    !instant &&
    beat != null &&
    matActor != null &&
    beat.actor === matActor &&
    phase === "act" &&
    ((pileKind === "draw" && (beat.kind === "draw" || beat.kind === "shuffle")) ||
      (pileKind === "discard" &&
        (beat.kind === "discard" ||
          beat.kind === "discard_from_pokemon" ||
          beat.kind === "play_trainer" ||
          beat.kind === "retreat")));

  // Landscape card slot at full card proportions: the card's long edge (342)
  // runs horizontally, its short edge (245 → `width`) vertically — i.e. the
  // portrait card turned on its side, same size. The holder widens to suit.
  const L = pileCardLong(width);
  const H = width;
  const holderW = L + 2 * m.pad;
  // Face-down piles (draw) show a card sleeve; face-up piles (discard) show the
  // actual top card. An empty pile stays a translucent slot.
  const hasFace = useCardBack || Boolean(topName);
  // Only the face-up top discard is worth inspecting (the draw pile is a
  // card back, an empty pile has nothing to show) — same "is there
  // anything to inspect" gate applies whether the click opens the default
  // single-card inspector or a caller's own handler.
  const clickable = onClick != null ? count > 0 : inspect != null && !useCardBack && Boolean(topName);

  return (
    <motion.div
      className={`relative bg-black shadow-sm ${className}`}
      style={{ width: holderW, borderRadius: m.radius, padding: m.pad }}
      title={hint ? `${label} · ${hint}` : label}
      // A nudge and a rim of light, not a bounce. This fires several times a
      // turn — cards are drawn, Trainers are discarded — so it has to be
      // legible at a glance and completely ignorable, or it becomes the
      // busiest thing on a board where it is the least important.
      animate={
        pileActive
          ? {
              scale: [1, 1.055, 1],
              boxShadow: [
                "0 0 0 0 rgba(255,255,255,0)",
                "0 0 14px 2px rgba(255,255,255,0.5)",
                "0 0 0 0 rgba(255,255,255,0)",
              ],
            }
          : { scale: 1, boxShadow: "0 0 0 0 rgba(255,255,255,0)" }
      }
      transition={{ duration: 0.42, ease: "easeOut" }}
    >
      {/* Landscape card slot — inset by the holder padding for concentric corners. */}
      <div
        className={`relative w-full overflow-hidden ${clickable ? "cursor-pointer" : ""}`}
        style={{
          height: H,
          borderRadius: m.cardRadius,
          background: hasFace ? "#fff" : "rgba(255,255,255,0.06)",
        }}
        role={clickable ? "button" : undefined}
        onClick={
          !clickable
            ? undefined
            : onClick ??
              (() =>
                inspect!({
                  kind: "card",
                  name: topName as string,
                  imageUrl: topImageUrl ?? null,
                }))
        }
      >
        {useCardBack ? (
          <CardSleeve radius={m.cardRadius} />
        ) : !hasFace ? null : face === "label" ? (
          <CardLabelFace text={topName ?? ""} width={width} />
        ) : (
          <>
            <RotatedCardFace
              src={topImageUrl ?? CARD_BACK_URL}
              alt={topName ?? ""}
              L={L}
              H={H}
              radius={m.cardRadius}
              rotate={rotate}
            />
            {topName && !topImageUrl && (
              <div className="absolute inset-x-1 top-1 rounded bg-black/60 px-1 py-0.5 text-center text-[9px] font-semibold leading-tight text-white line-clamp-2">
                {topName}
              </div>
            )}
          </>
        )}
      </div>

      {/* Label row — mirrors the HP header: label left, count right. */}
      <div
        className="flex items-center justify-between leading-none text-white"
        style={{ fontSize, marginTop: m.gap }}
      >
        <span className="font-bold uppercase">{label}</span>
        <span className="font-semibold tabular-nums">{count}</span>
      </div>
    </motion.div>
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

export function ConditionPill({ condition }: { condition: string }) {
  const meta =
    CONDITION_PILL[condition] ?? {
      label: condition.slice(0, 3).toUpperCase(),
      cls: "bg-gray-500 text-white",
    };
  return (
    <span
      className={`rounded-full px-1 py-[1px] text-[6px] font-bold uppercase leading-none shadow-sm ${meta.cls}`}
      title={condition}
    >
      {meta.label}
    </span>
  );
}

// Above this many attachments the row collapses to one icon and a count.
// Four is what the card footer fits at board scale; past that the icons
// start running the width of the card and stop being countable at a glance,
// which is the only thing the row is there to convey.
const ENERGY_ICONS_MAX = 4;

/**
 * The single type that stands in for a collapsed stack: whichever is
 * attached most, ties going to whichever was attached first. A mixed stack
 * has no honest single answer, but the plurality is the least misleading of
 * the options — and the count beside it is exact either way.
 */
function dominantEnergyType(types: string[]): string {
  const counts = new Map<string, number>();
  for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
  let best = types[0];
  let bestCount = 0;
  // Iterating the original order (not the map) is what makes ties resolve
  // to the earliest attachment: a later type has to strictly beat the
  // incumbent to replace it.
  for (const t of types) {
    const n = counts.get(t) ?? 0;
    if (n > bestCount) {
      best = t;
      bestCount = n;
    }
  }
  return best;
}

/** Attached-energy icons for a card footer, in attach order — or, once past
 *  ENERGY_ICONS_MAX, one icon and an "×N" total. */
function EnergyRow({
  types,
  iconSize,
}: {
  types: string[];
  /** Explicit px size (inspector). Omitted on the board, which uses the
   *  responsive classes instead. */
  iconSize?: number;
}) {
  // On the board: 25% smaller on mobile, full size on sm+. In the
  // inspector: scaled proportionally to the enlarged card.
  const iconClass =
    iconSize == null ? "h-[7.5px] w-[7.5px] sm:h-[10px] sm:w-[10px]" : undefined;
  const iconStyle =
    iconSize == null ? undefined : { height: iconSize, width: iconSize };

  if (types.length > ENERGY_ICONS_MAX) {
    const type = dominantEnergyType(types);
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/types/${type.toLowerCase()}.png`}
          alt={type}
          className={iconClass}
          style={iconStyle}
        />
        <span
          // Tracks the icon so the pair scales together at either size.
          className={`font-bold leading-none text-white tabular-nums ${
            iconSize == null ? "text-[7px] sm:text-[9px]" : ""
          }`}
          style={iconSize == null ? undefined : { fontSize: Math.round(iconSize * 0.95) }}
        >
          ×{types.length}
        </span>
      </>
    );
  }

  return (
    <>
      {types.map((t, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={i}
          src={`/types/${t.toLowerCase()}.png`}
          alt={t}
          className={iconClass}
          style={iconStyle}
        />
      ))}
    </>
  );
}

export function PokemonCardImage({
  mon,
  width,
  inspectable = true,
  energyIconSize,
  onClick,
  footer,
  dimmed,
  face = "art",
  perform = true,
  idle = false,
}: {
  mon: PokemonFrame;
  width: number;
  /** When true (board context), tapping opens the card inspector. The
   *  inspector renders its own copy with this off so it can't re-open. */
  inspectable?: boolean;
  /** Explicit energy-icon px size. When omitted, the responsive board sizes
   *  apply; the inspector passes a value proportional to the enlarged card. */
  energyIconSize?: number;
  /** Play mode: overrides the inspector tap with a game action. */
  onClick?: () => void;
  /** Play mode: content rendered INSIDE the black holder, below the HP bar,
   *  growing the holder downward (the Active's attack list). Kept as a slot
   *  rather than baked in so BoardKit stays presentational — it knows nothing
   *  about attacks, legality or damage. */
  footer?: ReactNode;
  /** Play mode: this card is NOT a legal target for the selection in
   *  progress, so it recedes.
   *
   *  Targeting marks the negative rather than the positive — dimming what
   *  cannot be chosen instead of outlining what can. Outlining every legal
   *  target draws a lot of chrome on a board that is mostly legal targets;
   *  dimming leaves the eligible cards looking exactly like themselves and
   *  simply pushes the rest back. */
  dimmed?: boolean;
  /** See CardFace — "label" names the Pokémon instead of showing its art. */
  face?: CardFace;
  /** Perform the current beat: pose, sheen, damage counters, pointer tilt.
   *  Off inside the card inspector, where the card is already the whole
   *  subject and a lifted, tilting copy of it just wobbles. */
  perform?: boolean;
  /** This is the Active Pokémon — give it a slow idle so the board is never
   *  completely still. */
  idle?: boolean;

}) {
  const inspect = useContext(InspectContext);
  // Passing null rather than skipping the call: the hook has to run on every
  // render regardless of whether this card is performing.
  // Role comes from the mat, which can see the whole board — a card on its
  // own cannot tell an attacker from an identically named Pokémon on the
  // bench. Via context rather than a prop so a card still exiting the board
  // (a knockout) sees the beat that removed it; see ClaimContext.
  const claim = useClaim(perform ? mon.id : null);
  const perf = useCardPerformance(claim);
  const { instant: beatInstant, reducedMotion } = useBeat();
  // The card's own box, so it can tell the FX layer and the camera where it
  // is. Nothing else needs board geometry as a result — see fxBus.
  const boxRef = useRef<HTMLDivElement>(null);
  // Last (action, phase, role) this card fired for. Effects are one-shot
  // punctuation, and React will happily re-run an effect for an unrelated
  // re-render mid-beat; without this a held frame emits a burst per render.
  const firedRef = useRef<string | null>(null);

  const { role: perfRole, phase: perfPhase, beat: perfBeat } = perf;
  useEffect(() => {
    if (!perform || reducedMotion || beatInstant) return;
    if (!perfBeat || perfRole === "bystander") return;
    const key = `${perfBeat.actionIndex}:${perfPhase}:${perfRole}`;
    if (firedRef.current === key) return;
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return;
    firedRef.current = key;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;

    // Ask for the camera on every phase; it keeps only the first request per
    // action, so this doesn't need to work out which phase came first.
    if (perfRole === focusRole(perfBeat)) {
      emitFocus({
        clientX: cx,
        clientY: cy,
        actionIndex: perfBeat.actionIndex,
        climax: perfBeat.weight === "climax",
      });
    }

    if (perfRole === "target" && perfPhase === "impact") {
      if (perfBeat.kind === "attack") {
        // Damage read as intensity, flattened with a square root so a 330
        // doesn't produce three times the debris of a 110 — past a point
        // more particles stop reading as more force and start reading as
        // more particles. 120 is roughly a one-prize hit.
        emitFx({
          kind: "impact",
          clientX: cx,
          clientY: cy,
          intensity: Math.min(2.2, Math.sqrt(perfBeat.damage / 120)),
          color: "#ff5a4d",
        });
      } else if (perfBeat.kind === "damage_counters") {
        emitFx({ kind: "impact", clientX: cx, clientY: cy, intensity: 0.5, color: "#ff8a5c" });
      } else if (perfBeat.kind === "condition") {
        // Converging rather than bursting: a condition settles onto a
        // Pokémon and stays there. A burst would read as it being shaken off.
        emitFx({
          kind: "converge",
          clientX: cx,
          clientY: cy,
          intensity: 1.1,
          color: conditionColor(perfBeat.condition),
        });
      } else if (perfBeat.kind === "discard_from_pokemon") {
        emitFx({ kind: "spark", clientX: cx, clientY: cy, intensity: 0.7, color: "#cbd5e1" });
      } else if (perfBeat.kind === "knock_out") {
        // Fired from the card on its way out: AnimatePresence keeps a
        // knocked-out Pokémon mounted through its exit, so it is still here
        // to say where it fell. The engine's own event can't help — by this
        // frame the card is in the discard pile.
        emitFx({ kind: "debris", clientX: cx, clientY: cy, intensity: 1.5, color: "#f8fafc" });
      }
    }

    if (perfRole === "target" && perfPhase === "act" && perfBeat.kind === "attach_energy") {
      emitFx({
        kind: "converge",
        clientX: cx,
        clientY: cy,
        intensity: 1,
        color: energyColor(perfBeat.energyType),
      });
    }

    if (perfRole === "actor" && perfPhase === "act" && perfBeat.kind === "ability") {
      emitFx({ kind: "spark", clientX: cx, clientY: cy, intensity: 1, color: "#a5f3fc" });
    }

    // Name the move over the card using it. Emitted on `act` so the plate is
    // fully in and drifting by `impact`, which is when the damage lands on
    // the other mat — the two are one event, and they're kept together by
    // both hanging off the director's phase rather than off timers of their
    // own.
    //
    // The plate is drawn at board level (see MoveNamePlate), so this reports
    // the card's top-centre rather than rendering anything here.
    if (perfRole === "actor" && perfPhase === "act") {
      // An attack whose name the parser didn't capture has nothing to say,
      // and a blank plate is worse than none.
      const label =
        perfBeat.kind === "attack"
          ? perfBeat.attack
          : perfBeat.kind === "ability"
            ? perfBeat.ability
            : null;
      if (label) {
        emitMovePlate({
          actionIndex: perfBeat.actionIndex,
          label,
          kind: perfBeat.kind === "attack" ? "attack" : "ability",
          clientX: cx,
          clientY: r.top,
          cardWidth: r.width,
        });
      }
    }
  }, [perform, reducedMotion, beatInstant, perfBeat, perfPhase, perfRole]);
  const clickable = onClick != null || (inspectable && inspect != null);
  const remainingHp = mon.hp != null ? Math.max(0, mon.hp - mon.damage) : null;
  const hadFallback = !mon.imageUrl;
  const m = replayTrayMetrics(width);
  const barH = Math.max(3, Math.round(m.strip * 0.22));
  const hpFontSize = holderFontSize(width);
  // A tool sits behind the Pokémon card, shifted up so its title peeks
  // above (a stack read). The peek height reserves space at the top of the
  // black holder so it stays contained.
  // Tools render as art behind the Pokémon card; a label face has no art for
  // them to peek out from, so the label mode drops them.
  const tools = face === "label" ? [] : (mon.tools ?? []);
  const toolPeek = tools.length > 0 ? Math.round(m.cardH * 0.13) : 0;

  // HP as a percentage of the card's printed maximum.
  const hpPct =
    mon.hp != null && mon.hp > 0 && remainingHp != null
      ? Math.max(0, Math.min(100, (remainingHp / mon.hp) * 100))
      : null;
  // Full HP → green, anything above 20% → yellow, 20% or below → red.
  const hpColor =
    hpPct == null
      ? "transparent"
      : hpPct >= 100
        ? "#22c55e"
        : hpPct > 20
          ? "#facc15"
          : "#ef4444";
  // The bar fills left-to-right in a darker-to-lighter sweep of whichever
  // state color it is, so the fill has some depth instead of reading as a
  // flat block. The dark stop is derived with shade() rather than paired
  // hexes per state — one number to tune, and a new state color can't ship
  // with a mismatched partner. -28% sits in the same family as the playmat
  // gradients (-22) but a touch deeper, which the small bar needs for the
  // two stops to separate at all at 3–5px tall.
  //
  // "transparent" isn't a hex and has no darker version — shade() would
  // hand it straight back and the gradient would be transparent→transparent
  // — so the no-printed-HP case stays the flat keyword it always was.
  const hpFill =
    hpColor === "transparent"
      ? "transparent"
      : `linear-gradient(90deg, ${shade(hpColor, -28)} 0%, ${hpColor} 100%)`;

  return (
    <CardSurface
      pose={perf.pose}
      width={m.containerW}
      radius={m.radius}
      tilt={perform}
      idle={idle}
    >
    <div
      className={`relative bg-black shadow-sm transition-opacity duration-200 ${
        clickable ? "cursor-pointer" : ""
      } ${dimmed ? "opacity-50" : ""}`}
      style={{ width: m.containerW, borderRadius: m.radius, padding: m.pad }}
      title={mon.name}
      role={clickable ? "button" : undefined}
      onClick={
        onClick ??
        (inspectable && inspect != null
          ? () => inspect({ kind: "pokemon", mon })
          : undefined)
      }
    >
      {/* Tool card(s) behind the Pokémon, shifted up so the title band shows
          above the Pokémon card, still inside the black holder. */}
      {tools.map((tool, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`${tool.name}-${i}`}
          src={tool.imageUrl ?? CARD_BACK_URL}
          alt={tool.name}
          title={tool.name}
          className="pointer-events-none absolute object-cover shadow"
          style={{
            top: m.pad + i * Math.round(toolPeek * 0.5),
            left: m.pad,
            width: m.cardW,
            height: m.cardH,
            borderRadius: m.cardRadius,
            zIndex: 0,
          }}
          onError={(e) => {
            if (e.currentTarget.src !== CARD_BACK_URL) e.currentTarget.src = CARD_BACK_URL;
          }}
        />
      ))}
      {/* Card image — full size (same as the stand-alone cards), inset by the
          holder padding for a concentric corner radius. */}
      <div
        ref={boxRef}
        className="relative w-full overflow-hidden bg-white"
        style={{ height: m.cardH, borderRadius: m.cardRadius, marginTop: toolPeek, zIndex: 1 }}
      >
        {face === "label" ? (
          <CardLabelFace text={mon.name} width={width} />
        ) : (
          // Keyed on the name so an evolution mounts a NEW face over the old
          // one rather than swapping the src in place.
          //
          // This is the paper gesture: you don't transform a Pokémon into its
          // next stage, you put a card down on top of it. Both faces are
          // present through the transition — AnimatePresence keeps the outgoing
          // one mounted, still showing the pre-evolution art — so the new stage
          // is visibly landing on the old, which is what the log line actually
          // describes. It earns its keep on a plain bench drop too, where a
          // card now falls onto the mat instead of materialising there.
          //
          // Suppressed on a jump: a scrub would otherwise rain every card on
          // the board onto the mat at once.
          <AnimatePresence initial={false}>
            <motion.div
              key={mon.name}
              className="absolute inset-0"
              initial={
                beatInstant || reducedMotion || !perform
                  ? false
                  : { y: -m.cardH * 0.5, rotateZ: -8, opacity: 0 }
              }
              animate={{ y: 0, rotateZ: 0, opacity: 1 }}
              transition={{ type: "spring", stiffness: 460, damping: 30, mass: 0.8 }}
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
                <div className="absolute inset-x-1 top-1 rounded bg-black/60 px-1 py-0.5 text-center text-[7px] font-semibold leading-tight text-white line-clamp-2">
                  {mon.name}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        )}
        {mon.conditions.length > 0 && (
          // Status pills stay on the card, stacked up from the bottom-right.
          <div className="pointer-events-none absolute bottom-1 right-1 z-10 flex flex-col-reverse items-end gap-0.5">
            {mon.conditions.map((c) => (
              <ConditionPill key={c} condition={c} />
            ))}
          </div>
        )}
        {mon.energyTypes.length > 0 && (
          // Gradient footer matches the Card Catalog's CardFooterOverlay so
          // the energy icons sit on the same darkened band shape across the
          // app. Energies render left-to-right in attach order. The band is
          // there to lift the icons off busy card art; a label face has no
          // art, and the gradient just reads as a smudge, so it drops out.
          <div
            className={`pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-start gap-[2px] px-0 pb-1 ${
              face === "label" ? "" : "pt-3 bg-gradient-to-b from-transparent to-black to-80%"
            }`}
          >
            <EnergyRow types={mon.energyTypes} iconSize={energyIconSize} />
          </div>
        )}
        {/* The light catching a foil as it's tilted into the play. Only the
            card actually doing something gets it — a sheen on every card at
            once is glitter, not emphasis. */}
        <FoilSheen
          active={perf.role === "actor" && (perf.pose === "windup" || perf.pose === "strike")}
          radius={m.cardRadius}
        />
        {/* The condition's own colour washing over the card as it takes
            hold — the pill in the corner is a record, this is the event. */}
        <AnimatePresence>
          {perf.role === "target" &&
            perf.phase === "impact" &&
            perf.beat?.kind === "condition" && (
              <motion.div
                key={`${perf.beat.actionIndex}-cond`}
                className="pointer-events-none absolute inset-0 z-20"
                style={{
                  borderRadius: m.cardRadius,
                  background: conditionColor(perf.beat.condition),
                  mixBlendMode: "hard-light",
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0.62, 0.28] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              />
            )}
        </AnimatePresence>
        <AnimatePresence>
          {perf.role === "target" &&
            perf.phase === "impact" &&
            perf.incomingDamage != null && (
              <DamageBurst
                key={`${perf.beat?.actionIndex}-dmg`}
                amount={perf.incomingDamage}
                fontSize={Math.max(11, Math.round(m.cardW * 0.34))}
                radius={m.cardRadius}
              />
            )}
        </AnimatePresence>
      </div>

      {/* Info strip — HP header (label + remaining/total) above the HP bar. */}
      {hpPct != null && (
        <div
          className="flex flex-col gap-[1px]"
          style={{ marginTop: m.gap }}
        >
          <div
            className="flex items-center justify-between leading-none text-white"
            style={{ fontSize: hpFontSize }}
          >
            <span className="font-bold uppercase">HP</span>
            <span className="font-semibold tabular-nums">{remainingHp}</span>
          </div>
          <div
            className="w-full overflow-hidden rounded-full bg-white/20"
            style={{ height: barH }}
          >
            {/* Drains rather than jumps. An HP bar that snaps to its new
                length is the single clearest tell that the board is a
                sequence of stills; draining it over the impact ties the
                number to the blow that caused it. */}
            <motion.div
              className="h-full rounded-full"
              style={{ background: hpFill }}
              initial={false}
              animate={{ width: `${hpPct}%` }}
              transition={{ type: "spring", stiffness: 180, damping: 26 }}
            />
          </div>
        </div>
      )}
      {footer != null && (
        // Stop the tap here: the holder's own onClick toggles this panel, so
        // letting a row bubble up would close it on the way to acting.
        <div style={{ marginTop: m.gap }} onClick={(e) => e.stopPropagation()}>
          {footer}
        </div>
      )}
    </div>
    </CardSurface>
  );
}

// Prize pile, in the same black holder as the other piles. The prizes are
// face down, so each is a card sleeve; up to 6 stack with a small vertical
// offset (and a stacked-card shadow) so it reads as "a stack of cards". The
// label row below shows "PRIZES" + remaining count.
export function StackedPrizePile({
  label,
  count,
  width,
  rotate: _rotate,
}: {
  label: string;
  count: number;
  width: number;
  rotate: PileRotate;
}) {
  const m = replayTrayMetrics(width);
  const fontSize = Math.max(6, Math.round((m.strip * 0.34) / CARD_IMAGE_BUMP));
  const layers = Math.max(0, Math.min(6, count));

  // Claiming a prize is the only thing that happens to this pile, and it's
  // the thing the whole game is scored on — so it gets a flourish of its own
  // rather than being the one board element that silently decrements.
  const { beat, phase, instant, reducedMotion } = useBeat();
  const matActor = useMatActor();
  const pileRef = useRef<HTMLDivElement>(null);
  const firedRef = useRef<number | null>(null);
  useEffect(() => {
    if (reducedMotion || instant) return;
    if (!beat || beat.kind !== "prize_taken" || phase !== "act") return;
    if (matActor == null || beat.actor !== matActor) return;
    if (firedRef.current === beat.actionIndex) return;
    const el = pileRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return;
    firedRef.current = beat.actionIndex;
    emitFx({
      kind: "spark",
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
      // Scales with a multi-prize take: two prizes off a Pokémon ex should
      // land harder than one.
      intensity: 0.8 + 0.5 * Math.max(0, beat.count - 1),
      color: "#fde68a",
    });
  }, [beat, phase, instant, reducedMotion, matActor]);
  // Landscape card slot at full proportions (long edge horizontal).
  const L = pileCardLong(width);
  const H = width;
  const holderW = L + 2 * m.pad;
  // Per-layer vertical offset, in px. The card area grows to contain the stack
  // rather than shrinking the cards.
  const offset = Math.max(3, Math.round(width * 0.09));
  const stackSpan = layers > 0 ? (layers - 1) * offset : 0;
  const areaH = H + stackSpan;

  return (
    <div
      ref={pileRef}
      className="relative bg-black shadow-sm"
      style={{ width: holderW, borderRadius: m.radius, padding: m.pad }}
      title={label}
    >
      <div className="relative w-full" style={{ height: areaH }}>
        {layers === 0 ? (
          <div
            className="absolute inset-0 flex items-center justify-center border border-dashed border-white/20 text-white/40"
            style={{ borderRadius: m.cardRadius, fontSize }}
          >
            empty
          </div>
        ) : (
          Array.from({ length: layers }).map((_, i) => (
            <div
              key={i}
              className="absolute left-0 right-0"
              style={{ height: H, top: i * offset, zIndex: i }}
            >
              <CardSleeve radius={m.cardRadius} shadow={i > 0} />
            </div>
          ))
        )}
      </div>

      {/* Label row — mirrors the HP header: label left, count right. */}
      <div
        className="flex items-center justify-between leading-none text-white"
        style={{ fontSize, marginTop: m.gap }}
      >
        <span className="font-bold uppercase">{label}</span>
        <span className="font-semibold tabular-nums">{count}</span>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────── */
/* Player mat                                                       */
/* ──────────────────────────────────────────────────────────────── */

/** Play-mode interaction bundle. `side` orientation stays presentational:
 *  the callbacks fire for whichever side this mat renders. */
export interface MatInteraction {
  onActiveClick?: () => void;
  onBenchClick?: (benchIndex: number) => void;
  /** Rendered inside the Active's black holder, below the HP bar. */
  activeFooter?: ReactNode;
  dimActive?: boolean;
  /** Bench indexes to ring as legal targets. */
  dimBench?: boolean[];
}

// P1 mat: bench at top, active at bottom — actives face each other across the
// gap between the two mats. P2 mat: active at top, bench at bottom.
//
// 3-column grid: [left-rail] [center 1fr] [right-rail]
// Stadium and played-trainer are absolutely positioned overlays that float
// on a higher z-layer so they never affect bench centering or active centering.
export function PlayerMat({
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
  interact,
  instant,
  actor,
  onDiscardClick,
  matGradient = BOARD_GRADIENT,
  face = "art",
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
  interact?: MatInteraction;
  /** Overrides the discard pile's default tap (open the top card alone) —
   *  the Replay viewer wires this to its full-pile inspector. Omitted
   *  elsewhere (AI-player practice mode), where the pile keeps its default
   *  single-card behavior. */
  onDiscardClick?: () => void;
  /** CSS gradient for this mat's background. Defaults to BOARD_GRADIENT
   *  (the fixed fire-lightning look every board used to share) — the
   *  Replay viewer overrides it per side with a gradient keyed to that
   *  deck's hero Pokémon energy type. */
  matGradient?: string;
  /** Render the destination state immediately instead of animating cards
   *  into it. Replay sets this when the playhead jumps (scrub / turn skip),
   *  where a slot-to-slot animation would trace a path the game never took
   *  and can strand cards mid-flight. Play mode never jumps, so it animates. */
  instant?: boolean;
  /** See CardFace. "label" renders every face-up card as its name in text
   *  rather than its art — the Learn to Play board draws this mat that way
   *  so the regions read as regions instead of as a particular matchup. */
  face?: CardFace;
  /** Whose cards this mat is showing. NOT the same as `side`, which names the
   *  visual slot and is deliberately pinned (the top mat is always laid out
   *  "player"-style with its tray on its own floor) regardless of whose data
   *  it holds. Replay 2.0's beat matching needs to know the attacker from the
   *  defender, so it gets its own prop rather than misreading `side`.
   *  Omitted by callers with no beats (the AI-player practice mode), where
   *  every card simply rests. */
  actor?: "player" | "opponent";
}) {
  const isPlayer = side === "player";

  // Which cards on THIS mat the current beat is about, resolved once here
  // rather than guessed per card. See resolveClaim: a card matching on its
  // own name can only answer "does the beat mention something called what I
  // am called?", which every duplicate on the board answers yes to — which is
  // how an attack ended up being attributed to a benched Pokémon sharing the
  // attacker's name.
  const { beat: currentBeat } = useBeat();
  const matCards = useMemo<MatCards>(() => ({ active, bench }), [active, bench]);
  const previousMatCards = usePreviousMatCards(matCards);
  const claim = resolveClaim(currentBeat, actor ?? null, matCards, previousMatCards);
  const claimFor = useMemo(() => {
    const { actorId, targetId } = claim;
    return (id: string): CardRole | null =>
      id === actorId ? "actor" : id === targetId ? "target" : null;
  }, [claim.actorId, claim.targetId]);

  // A spring, not a linear tween. v1's constant-velocity 300ms ease is what a
  // sprite does; a card set down by a hand decelerates into place and stops
  // dead. Paired with the travel lift below (which raises the card and
  // deepens its shadow while it's in the air), a promotion reads as being
  // picked up and put down rather than sliding across the mat.
  //
  // instant still runs through the same framer-motion path so layout
  // bookkeeping stays consistent — the move just lands on the same tick.
  const moveTransition = instant
    ? ({ duration: 0 } as const)
    : ({ type: "spring", stiffness: 320, damping: 30, mass: 0.9 } as const);
  const texScale = matWidth > 0 ? matWidth / 600 : 1;
  const inspect = useContext(InspectContext);

  // ── Overlay geometry ──────────────────────────────────────────────────────
  // The center column's horizontal midpoint is always innerW/2 regardless of
  // gap size (the gaps cancel out in the algebra). Active card is centered there.
  const innerW = matWidth - 2 * MAT_PADDING;
  const innerH = matWidth * MAT_ASPECT - 2 * MAT_PADDING;
  const cardH = cardWidth * (342 / 245);
  const FLOAT_GAP = BOARD_CARD_GAP; // px between floating card and its anchor

  // Active Pokémon renders inside a tray (card + info strip), taller than
  // the bare card. The grid pins the tray to the bottom (P1) / top (P2) of the
  // center column; this resolves the card *image* top within that tray so the
  // floating stadium / played-trainer cards still line up with the card art.
  const activeTray = replayTrayMetrics(cardWidth);
  // Rail columns are sized to the rotated pile holders (landscape, full card
  // proportions), which are wider than the active's portrait holder.
  const railW = pileHolderWidth(cardWidth);
  // The active Pokémon's holder is wider than the bare card by 2*pad; the
  // floating stadium / played-trainer anchor off the holder's edge.
  const activeHalf = activeTray.containerW / 2;
  const activeMatTop = isPlayer
    ? MAT_PADDING + innerH - activeTray.totalH + activeTray.pad // P1: tray bottom-pinned
    : MAT_PADDING + activeTray.pad;                             // P2: tray top-pinned

  // Center the bare stadium / played-trainer cards on the active Pokémon's
  // holder: take the holder's vertical midpoint and back off half a card
  // height. The holder top is the card-art top minus its padding.
  const activeContainerTop = activeMatTop - activeTray.pad;
  const overlayTop =
    activeContainerTop + activeTray.totalH / 2 - cardH / 2;

  // Stadium floats at same height as the active; anchored right (P1) or left (P2)
  // — opposite side from the active Pokémon's center.
  const stadiumLeft = isPlayer
    ? MAT_PADDING + innerW / 2 + activeHalf + FLOAT_GAP  // P1: right of active
    : MAT_PADDING + innerW / 2 - activeHalf - FLOAT_GAP - cardWidth; // P2: left of active

  // Played trainer floats where the stadium used to be: left of active (P1),
  // right of active (P2), vertically centered on the active row.
  const playedTrainerTop = overlayTop;
  const playedTrainerLeft = isPlayer
    ? MAT_PADDING + innerW / 2 - activeHalf - FLOAT_GAP - cardWidth // P1: left of active
    : MAT_PADDING + innerW / 2 + activeHalf + FLOAT_GAP;            // P2: right of active

  // Bench sizing: cards fill the full inner mat width divided by bench count.
  // Height-constrained to the same row height as the active card. Since the
  // bench is an absolute overlay, it never competes with the grid layout.
  const n = bench.length || 1;
  const benchCardWidth = Math.max(20, Math.floor(Math.min(
    cardH * (245 / 342),                    // height: same card size as active
    // width: fit n holders (each wider than its card by the container factor)
    (innerW - Math.max(0, n - 1) * BOARD_CARD_GAP) / (n * CONTAINER_W_FACTOR),
  )));
  const benchTray = replayTrayMetrics(benchCardWidth);
  const benchTop = isPlayer
    ? MAT_PADDING                                 // P1: bench tray at top of mat interior
    : MAT_PADDING + innerH - benchTray.totalH;    // P2: bench tray at bottom of mat interior

  // Active slot: single card, clean fade+layout transition. The layoutId
  // receives the card from the bench when a Pokémon is promoted.
  const activeRow = (
    <div className="flex justify-center" style={{ minWidth: activeTray.containerW }}>
      <AnimatePresence mode="wait">
        {active && (
          <ActiveSlot
            key={active.id}
            mon={active}
            side={side}
            containerW={activeTray.containerW}
            cardWidth={cardWidth}
            instant={instant}
            moveTransition={moveTransition}
            interact={interact}
            face={face}
          />
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <MatActorContext.Provider value={actor ?? null}>
    <ClaimContext.Provider value={claimFor}>
    <LayoutGroup id={side}>
      {/* The mat itself does NOT clip its contents.
          
          v1 painted the gradient and texture on this element and gave it
          overflow-hidden to keep them inside the rounded corners — which was
          free, because nothing ever left the mat. Replay 2.0's cards lift:
          a bench Pokémon at full strike is scaled 1.10 and pushed ~46px
          toward the viewer, which perspective turns into roughly 21% of
          extra height, about half of it above the card. The opponent's bench
          sits MAT_PADDING (8px) from the top edge, so a struck or lifted card
          had its top sheared off by the mat boundary.

          So the background moves to its own clipped layer and the mat
          becomes a plain positioning shell. The background still has the
          rounded corners; the cards are simply no longer inside anything
          that trims them. Cards overflowing the mat edge is correct — a card
          held above the table should break its silhouette. */}
      <div
        className="relative rounded-xl"
        style={{
          padding: MAT_PADDING,
          height: matWidth > 0 ? matWidth * MAT_ASPECT : undefined,
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-xl overflow-hidden"
          style={{
            backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(BOARD_TEXTURE.svg)}"), ${matGradient}`,
            backgroundSize: `${BOARD_TEXTURE.w * texScale}px ${BOARD_TEXTURE.h * texScale}px, auto`,
          }}
        />
        {/* ── 3-column grid: left-rail | center | right-rail. Rails are sized
            to the rotated (landscape) pile holders. ──

            `relative` so the rails paint above the background layer: that
            layer is positioned and this content would otherwise be static,
            which puts it underneath regardless of DOM order. */}
        <div
          className="relative grid h-full gap-1.5 sm:gap-3"
          style={{ gridTemplateColumns: `${railW}px 1fr ${railW}px` }}
        >
          {/* Left rail — cards rotate top-toward-left (outer edge). On the top
              (player) mat the piles anchor to the bottom of the mat. */}
          <div className={`flex h-full flex-col gap-1.5 sm:gap-3 ${isPlayer ? "justify-end" : ""}`}>
            {isPlayer ? (
              <>
                <Pile label="Discard" count={discardCount} width={cardWidth} rotate="ccw" topName={discardTop} topImageUrl={discardTopImageUrl} onClick={onDiscardClick} face={face} />
                <Pile label="Draw" count={deckCount} width={cardWidth} rotate="ccw" hint={`${handCount} in hand`} useCardBack />
              </>
            ) : (
              <StackedPrizePile label="Prizes" count={prizesRemaining} width={cardWidth} rotate="ccw" />
            )}
          </div>
          {/* Center: active card only — bench is an absolute overlay */}
          <div className={`flex h-full flex-col ${isPlayer ? "justify-end" : "justify-start"}`}>
            {activeRow}
          </div>
          {/* Right rail — cards rotate top-toward-right (outer edge). On the top
              (player) mat the piles anchor to the bottom of the mat. */}
          <div className={`flex h-full flex-col gap-1.5 sm:gap-3 ${isPlayer ? "justify-end" : ""}`}>
            {isPlayer ? (
              <StackedPrizePile label="Prizes" count={prizesRemaining} width={cardWidth} rotate="cw" />
            ) : (
              <>
                <Pile label="Draw" count={deckCount} width={cardWidth} rotate="cw" hint={`${handCount} in hand`} useCardBack />
                <Pile label="Discard" count={discardCount} width={cardWidth} rotate="cw" topName={discardTop} topImageUrl={discardTopImageUrl} onClick={onDiscardClick} face={face} />
              </>
            )}
          </div>
        </div>

        {/* ── Bench overlay (z-0, behind stadium/trainer, full mat width) ── */}
        {bench.length > 0 && (
          <div
            // items-end: holders differ in height (a Tool peeks above the
            // card, a Pokémon with no printed HP has no bar), and hanging them
            // from a shared TOP left their card art at different heights. The
            // bottom edge is the one the eye reads as the row.
            // No overflow-hidden: it was the inner half of the clipping pair
            // described on the mat above, and the one that bit first — the
            // row's box is only as tall as its holders, so ANY lift was
            // trimmed at its top edge immediately, not just one near the mat
            // boundary. Nothing needs the clip: benchCardWidth is derived by
            // dividing the mat's inner width among the cards, so the row is
            // sized to fit rather than relying on being cut off.
            className="absolute z-0 flex items-end justify-center"
            style={{ top: benchTop, left: MAT_PADDING, width: innerW, gap: BOARD_CARD_GAP }}
          >
            {/* Wrapped so a Pokémon leaving the bench — knocked out, or
                promoted away — is still mounted through its exit. Beyond
                looking better than a card blinking out, it is what lets a
                benched knockout emit its debris from where it actually
                stood: by the knockout frame the engine has already moved
                the card to the discard. */}
            <AnimatePresence initial={false}>
            {bench.map((mon, i) => (
              <BenchSlot
                key={mon.id}
                mon={mon}
                side={side}
                containerW={benchTray.containerW}
                cardWidth={benchCardWidth}
                moveTransition={moveTransition}
                onClick={
                  interact?.onBenchClick ? () => interact.onBenchClick!(i) : undefined
                }
                dimmed={interact?.dimBench?.[i]}
                face={face}
              />
            ))}
            </AnimatePresence>
          </div>
        )}

        {/* ── Floating overlays (z-10, don't affect grid flow) ── */}
        <AnimatePresence>
          {stadium && (
            <motion.div
              key={stadium.name}
              className="absolute z-10"
              style={{ top: overlayTop, left: stadiumLeft, width: cardWidth }}
              title={stadium.name}
              initial={{ opacity: 0, y: -14, scale: 1.06 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ type: "spring", stiffness: 380, damping: 28 }}
            >
              <FloatingCard
                name={stadium.name}
                imageUrl={stadium.imageUrl}
                width={cardWidth}
                face={face}
              />
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {lastPlayedTrainer && (
            <motion.div
              key={lastPlayedTrainer.name}
              className="absolute z-10"
              style={{ top: playedTrainerTop, left: playedTrainerLeft, width: cardWidth }}
              title={lastPlayedTrainer.name}
              // A Trainer is played face-up onto the mat and then discarded,
              // so it arrives with a flick and leaves by being swept away —
              // not by dissolving where it lies.
              initial={{ opacity: 0, y: -22, rotateZ: -7, scale: 1.1 }}
              animate={{ opacity: 1, y: 0, rotateZ: 0, scale: 1 }}
              exit={{ opacity: 0, x: 10, rotateZ: 5, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 420, damping: 26 }}
            >
              <FloatingCard
                name={lastPlayedTrainer.name}
                imageUrl={lastPlayedTrainer.imageUrl}
                width={cardWidth}
                face={face}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </LayoutGroup>
    </ClaimContext.Provider>
    </MatActorContext.Provider>
  );
}

/**
 * The Active slot. Its own component so it can hold the travel-lift state a
 * promotion needs — a bench Pokémon arriving here flies in on a shared
 * layoutId, and the lift is what turns that flight into a hand moving a card.
 */
function ActiveSlot({
  mon,
  side,
  containerW,
  cardWidth,
  instant,
  moveTransition,
  interact,
  face,
}: {
  mon: PokemonFrame;
  side: "player" | "opponent";
  containerW: number;
  cardWidth: number;
  instant?: boolean;
  moveTransition: object;
  interact?: MatInteraction;
  face?: CardFace;
}) {
  const { traveling, handlers } = useTravelLift();
  return (
    <motion.div
      layoutId={`${side}-${mon.id}`}
      // The expanded holder grows down into the bench overlay's band, and
      // that overlay is positioned (z-0) while this column is not — so
      // without an explicit layer the bench would paint over the attack
      // list. Only raised when there IS a footer, to leave the promotion
      // animation's stacking exactly as it was.
      className={interact?.activeFooter ? "relative z-20" : undefined}
      style={{ width: containerW, transformStyle: "preserve-3d" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, ...travelStyle(traveling) }}
      // Leaving the Active slot means one of two things — knocked out, or
      // retreated — and both are the card being swept off the table rather
      // than dissolving in place. v1 faded it, which reads as the card
      // never having been there.
      exit={{ opacity: 0, scale: 0.84, rotateZ: -7, y: 14 }}
      transition={{ duration: instant ? 0 : 0.24, layout: moveTransition }}
      {...handlers}
    >
      <PokemonCardImage
        mon={mon}
        width={cardWidth}
        onClick={interact?.onActiveClick}
        footer={interact?.activeFooter}
        dimmed={interact?.dimActive}
        face={face}
        idle
      />
    </motion.div>
  );
}

/** One bench Pokémon. Split out for the same reason as ActiveSlot: the
 *  travel lift is per-card state, and hooks can't live inside a .map. */
function BenchSlot({
  mon,
  side,
  containerW,
  cardWidth,
  moveTransition,
  onClick,
  dimmed,
  face,
}: {
  mon: PokemonFrame;
  side: "player" | "opponent";
  containerW: number;
  cardWidth: number;
  moveTransition: object;
  onClick?: () => void;
  dimmed?: boolean;
  face?: CardFace;
}) {
  const { traveling, handlers } = useTravelLift();
  return (
    <motion.div
      layoutId={`${side}-${mon.id}`}
      className="shrink-0"
      style={{ width: containerW, transformStyle: "preserve-3d" }}
      animate={travelStyle(traveling)}
      exit={{ opacity: 0, scale: 0.84, rotateZ: -7, y: 14 }}
      transition={{ layout: moveTransition, duration: 0.24 }}
      {...handlers}
    >
      <PokemonCardImage
        mon={mon}
        width={cardWidth}
        onClick={onClick}
        dimmed={dimmed}
        face={face}
      />
    </motion.div>
  );
}

/** Bare floating card (stadium / last-played trainer) with inspector tap. */
function FloatingCard({
  name,
  imageUrl,
  width,
  face = "art",
}: {
  name: string;
  imageUrl: string | null;
  /** Card-image width — only the label face needs it, to size its text. */
  width: number;
  face?: CardFace;
}) {
  const inspect = useContext(InspectContext);

  // Trainers and Stadiums never became beat subjects: the card matcher works
  // on Pokémon in play, and these two are the only cards that sit on a mat
  // without being one. Which left the busiest line in any log — several
  // Trainers a turn — as the one action with no acknowledgement anywhere on
  // the board.
  const { beat, phase, instant, reducedMotion } = useBeat();
  const matActor = useMatActor();
  const floatRef = useRef<HTMLDivElement>(null);
  const firedRef = useRef<number | null>(null);

  const isSubject =
    beat != null &&
    ((beat.kind === "play_trainer" && beat.card === name && beat.actor === matActor) ||
      // A Stadium firing belongs to the board rather than to a player, so it
      // is matched on the card alone — its `actor` is as often `system` as it
      // is whoever owns it.
      (beat.kind === "effect_activated" && beat.card === name));
  const lit = isSubject && !reducedMotion && !instant && (phase === "act" || phase === "impact");

  useEffect(() => {
    if (!isSubject || reducedMotion || instant) return;
    if (phase !== "act") return;
    if (!beat || firedRef.current === beat.actionIndex) return;
    const el = floatRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return;
    firedRef.current = beat.actionIndex;
    emitFocus({
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
      actionIndex: beat.actionIndex,
      climax: false,
    });
    emitFx({
      kind: "spark",
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
      intensity: 0.9,
      // Supporters are the turn's one big decision; Items and Stadiums are
      // texture. Colouring them apart means a glance at the board says which
      // kind of play just happened without reading the card.
      color:
        beat.kind === "play_trainer" && beat.subtype === "supporter"
          ? "#fbbf24"
          : "#e2e8f0",
    });
  }, [isSubject, phase, beat, instant, reducedMotion]);

  return (
    <motion.div
      ref={floatRef}
      className={`relative w-full overflow-hidden rounded bg-white ${inspect ? "cursor-pointer" : ""}`}
      style={{ aspectRatio: "245 / 342" }}
      role={inspect ? "button" : undefined}
      onClick={inspect ? () => inspect({ kind: "card", name, imageUrl }) : undefined}
      animate={
        lit
          ? { scale: 1.07, boxShadow: "0 10px 26px rgba(0,0,0,0.34)" }
          : { scale: 1, boxShadow: "0 0px 0px rgba(0,0,0,0)" }
      }
      transition={{ type: "spring", stiffness: 420, damping: 26 }}
    >
      {face === "label" ? (
        <CardLabelFace text={name} width={width} />
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl ?? CARD_BACK_URL}
            alt={name}
            className="h-full w-full object-cover"
            onError={(e) => {
              if (e.currentTarget.src !== CARD_BACK_URL) e.currentTarget.src = CARD_BACK_URL;
            }}
          />
          {!imageUrl && (
            <div className="absolute inset-x-1 top-1 rounded bg-black/60 px-1 py-0.5 text-center text-[7px] font-semibold leading-tight text-white line-clamp-2">
              {name}
            </div>
          )}
        </>
      )}
      <FoilSheen active={lit} radius={4} />
    </motion.div>
  );
}

/* ──────────────────────────────────────────────────────────────── */
/* Card inspector                                                   */
/* ──────────────────────────────────────────────────────────────── */

// Card inspector (lightbox) for the board. Mirrors the deck-profile card
// viewer — a gray semi-opaque scrim over the board with the tapped card
// presented large — but a Pokémon opens inside its full holder (HP bar +
// attached energies) rather than as a bare image.
export function ReplayCardInspector({
  target,
  onClose,
}: {
  target: InspectTarget;
  onClose: () => void;
}) {
  const [vp, setVp] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const measure = () =>
      setVp({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener("resize", measure);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  // Size the presented card to ~80vw / ~78vh, whichever binds first.
  const maxW = vp.w > 0 ? vp.w * 0.8 : 320;
  const maxH = vp.h > 0 ? vp.h * 0.78 : 480;

  const targetName = target.kind === "pokemon" ? target.mon.name : target.name;

  let content: JSX.Element;
  if (target.kind === "pokemon") {
    // The holder is `width * CONTAINER_W_FACTOR` wide and `width *
    // TRAY_TOTAL_RATIO` tall — invert both bounds and take the smaller width.
    const pokeWidth = Math.max(
      140,
      Math.floor(
        Math.min(maxW / CONTAINER_W_FACTOR, maxH / TRAY_TOTAL_RATIO),
      ),
    );
    content = (
      <PokemonCardImage
        mon={target.mon}
        width={pokeWidth}
        inspectable={false}
        energyIconSize={Math.max(12, Math.round(pokeWidth * 0.14))}
        // Frozen. The inspector is a still of one card at one moment; a copy
        // of it posing along with the beat behind it would be a second,
        // contradicting board.
        perform={false}
      />
    );
  } else {
    // Plain card: bound by the 245/342 aspect.
    const imgW = Math.floor(Math.min(maxW, maxH * (245 / 342)));
    content = (
      <div
        className="relative overflow-hidden rounded-[20px] sm:rounded-3xl bg-white shadow-lg"
        style={{ width: imgW, aspectRatio: "245 / 342" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={target.imageUrl ?? CARD_BACK_URL}
          alt={target.name}
          className="h-full w-full object-cover"
          onError={(e) => {
            if (e.currentTarget.src !== CARD_BACK_URL)
              e.currentTarget.src = CARD_BACK_URL;
          }}
        />
        {!target.imageUrl && (
          <div className="absolute inset-x-2 top-2 rounded bg-black/60 px-2 py-1 text-center text-sm font-semibold leading-tight text-white line-clamp-2">
            {target.name}
          </div>
        )}
      </div>
    );
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${targetName} preview`}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      // Scrim is built from --bg rather than a literal, so it follows the
      // theme instead of washing the dark board in light-mode grey. The
      // solid backgroundColor is the fallback layer: if color-mix isn't
      // supported the gradient is dropped and the scrim stays a correct,
      // if unfaded, themed surface.
      style={{
        backgroundColor: "var(--bg)",
        backgroundImage:
          "linear-gradient(180deg, var(--bg) 0%, color-mix(in srgb, var(--bg) 85%, transparent) 100%)",
      }}
      onClick={onClose}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close card viewer"
        className="absolute top-4 left-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition hover:bg-black/70"
      >
        <svg
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.75}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Stop taps on the card from bubbling to the scrim and dismissing. */}
      <div onClick={(e) => e.stopPropagation()}>{content}</div>
    </div>,
    document.body,
  );
}
