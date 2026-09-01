"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { Beat } from "@/lib/replay2/beats";
import type { BeatPhase } from "../director/choreography";

/**
 * The two ceremonies that open the match — the caller's call, then the
 * winner's decision on turn order. Each is one mat lit up, an animated
 * border drawn around it, and a plate over it naming what just happened.
 *
 * Board-level rather than per-mat: nothing here is about a card, and the
 * plate belongs to the whole ceremony (its own object, not a card badge).
 *
 * A previous version rendered a spinning coin. It was theatrical but read as
 * an event happening OFF the board rather than one that decided how the
 * board would begin — the mats stood empty and dim while it played, and the
 * moment the coin landed nothing on the mats acknowledged that anything had
 * happened. Highlighting the caller's mat, then the winner's, ties both
 * moments to the players whose game is about to start.
 */

interface Props {
  beat: Beat | null;
  phase: BeatPhase;
  reducedMotion: boolean;
  /**
   * Which visual half each ceremony belongs to. Both are resolved by the
   * caller from the frame's own handles — the board pins the submitting
   * player to the bottom mat and the opponent to the top, so an actor maps
   * straight onto an edge. `null` disables the ceremony (a mulligan-only
   * setup, or a beat whose actor wasn't recorded).
   */
  callerEdge: "top" | "bottom" | null;
  callerName: string | null;
  /** The TOSS winner's mat and name — the actor of coin_flip stage="won"
   *  and of chose_first. NOT necessarily the first player: the winner can
   *  choose to go second, and the plate names that too. */
  winnerEdge: "top" | "bottom" | null;
  winnerName: string | null;
  /** The winner's chosen order — "first" or "second". Renders as the
   *  ordinal in the winner plate. Null omits the ordinal (unusual — the
   *  log always names it, but the plate stays readable without it). */
  winnerOrder: "first" | "second" | null;
}

export function SetupCeremony({
  beat,
  phase,
  reducedMotion,
  callerEdge,
  callerName,
  winnerEdge,
  winnerName,
  winnerOrder,
}: Props) {
  // What to render this beat, if anything. Only one ceremony is on screen at
  // a time — this replaces both the coin spin and the older half-mat wash of
  // FirstPlayerCall with a single Spotlight variant per beat.
  //
  //   coin_flip / "call" — the caller's mat, with their call.
  //   coin_flip / "won"  — a brief winner nod, no plate. Almost immediately
  //                        superseded by chose_first, and a plate here would
  //                        be redundant with the one that comes next.
  //   chose_first        — the winner's mat, with the toss result AND the
  //                        turn order in one plate.
  let active: null | {
    edge: "top" | "bottom";
    label: string | null;
    kind: "call" | "wonBrief" | "decision";
  } = null;

  if (beat?.kind === "coin_flip" && beat.stage === "call") {
    if (callerEdge && callerName) {
      const call = (beat.choice ?? "").toLowerCase();
      const choice = call === "heads" || call === "tails" ? call : "the coin";
      active = { edge: callerEdge, label: `${callerName} calls ${choice}`, kind: "call" };
    }
  } else if (beat?.kind === "coin_flip" && beat.stage === "won") {
    // The winner's mat lights briefly on its own, but with no plate: the
    // next beat's plate says "won the toss AND will go 1st/2nd" and doing
    // both here first would land the same word twice back-to-back.
    if (winnerEdge) {
      active = { edge: winnerEdge, label: null, kind: "wonBrief" };
    }
  } else if (beat?.kind === "chose_first") {
    if (winnerEdge && winnerName) {
      const order = winnerOrder ?? "first";
      const ordinal = order === "second" ? "2nd" : "1st";
      active = {
        edge: winnerEdge,
        label: `${winnerName} won the toss and will go ${ordinal}`,
        kind: "decision",
      };
    }
  }

  return (
    <AnimatePresence>
      {active && !reducedMotion && phase !== "anticipate" && (
        <Spotlight
          key={`${beat!.actionIndex}-${active.kind}`}
          edge={active.edge}
          label={active.label}
          kind={active.kind}
          phase={phase}
        />
      )}
    </AnimatePresence>
  );
}

/* ──────────────────────────────────────────────────────────────── */
/* Spotlight                                                        */
/* ──────────────────────────────────────────────────────────────── */

/**
 * One mat's half of the board, lit up.
 *
 * A stroked rounded rectangle draws around the mat's outline the way the
 * poison border does around a struck card — one continuous path from a
 * single starting point, so the eye follows the stroke as it lands rather
 * than the whole outline appearing at once. Behind it, a warm wash on the
 * same half of the board, and the plate carrying the label sits centred
 * over the mat.
 *
 * The mat's shape is approximated rather than measured. Both mats are the
 * same size, stacked with a small gap, and each occupies almost exactly
 * one half of the camera stage: taking half the stage minus the gap gives a
 * rectangle that traces the visible mat closely enough for the stroke to
 * read as its own edge. Measuring exactly would mean a ref through
 * PlayerMat's context all the way here — worth the plumbing when the answer
 * differs, not when it doesn't.
 */
function Spotlight({
  edge,
  label,
  kind,
  phase,
}: {
  edge: "top" | "bottom";
  label: string | null;
  kind: "call" | "wonBrief" | "decision";
  phase: BeatPhase;
}) {
  const winner = kind !== "call";
  // Same warm gold that GameEndFlourish uses on the winning half at the
  // other end of the match, so the winning-mat spotlight visually rhymes
  // with the winning-mat flourish that closes it out. The caller reads as
  // neutral rather than triumphant — it is just a call, not a win — so it
  // wears a cooler blue.
  const strokeColor = winner ? "#facc15" : "#38bdf8";
  const strokeGlow = winner ? "rgba(250, 204, 21, 0.7)" : "rgba(56, 189, 248, 0.6)";
  const washColor = winner ? "rgba(255, 238, 170, 0.45)" : "rgba(191, 219, 254, 0.34)";
  const plateFrom = winner ? "#b45309" : "#0369a1";
  const plateTo = winner ? "#f59e0b" : "#22d3ee";
  const plateGlow = winner ? "rgba(245, 158, 11, 0.6)" : "rgba(34, 211, 238, 0.55)";
  return (
    <motion.div
      className="pointer-events-none absolute inset-0 z-40 overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      {/* The wash. Gathers on the ceremony's own half of the board, so the
          board itself says who this ceremony is about before the plate is
          read — same trick GameEndFlourish uses on the winner's side at the
          end. */}
      <motion.div
        className="absolute inset-x-0"
        style={{
          [edge]: 0,
          height: "50%",
          background:
            edge === "bottom"
              ? `linear-gradient(to top, ${washColor}, transparent 80%)`
              : `linear-gradient(to bottom, ${washColor}, transparent 80%)`,
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 0.75] }}
        transition={{ duration: 0.9, ease: "easeOut" }}
      />
      {/* The border draw. A single stroked path that runs its length once,
          the way ConditionBorder does around a struck card. */}
      <SpotlightBorder edge={edge} color={strokeColor} glow={strokeGlow} />
      {/* The plate. Skipped for the brief "won" nod between the call and
          the decision — that beat exists so the winner's mat isn't dark
          during "won the coin toss", not to duplicate the plate that
          follows. */}
      {label && (
        <div
          className="absolute inset-x-0 flex justify-center"
          style={
            edge === "bottom"
              ? { bottom: "24%" }
              : { top: "24%" }
          }
        >
          <Plate label={label} from={plateFrom} to={plateTo} glow={plateGlow} phase={phase} />
        </div>
      )}
    </motion.div>
  );
}

/**
 * The stroked outline itself.
 *
 * Half of the container tall, with a small inset that stands in for the
 * mat's own padding, and rounded corners in the neighbourhood of the mat's
 * own radius. pathLength normalises the perimeter to 1 so a single dash of
 * length 1 covers it — same trick ConditionBorder uses so the drawing has
 * a definite length regardless of size.
 */
function SpotlightBorder({
  edge,
  color,
  glow,
}: {
  edge: "top" | "bottom";
  color: string;
  glow: string;
}) {
  const stroke = 3;
  // Inset small enough that the stroke reads as ringing the mat itself, not
  // a rectangle floating over it.
  const inset = 6;
  return (
    <motion.svg
      className="pointer-events-none absolute"
      style={{
        left: inset,
        right: inset,
        [edge]: inset,
        // 50% of the container minus the top/bottom insets, so both mats
        // get their share and nothing crosses into the other side.
        height: `calc(50% - ${inset * 2}px)`,
        width: `calc(100% - ${inset * 2}px)`,
        overflow: "visible",
      }}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      <motion.rect
        x={stroke / 2}
        y={stroke / 2}
        width={100 - stroke}
        height={100 - stroke}
        rx={3}
        ry={3}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray="1 1"
        initial={{ strokeDashoffset: 1, opacity: 0 }}
        animate={{ strokeDashoffset: 0, opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.35 } }}
        transition={{
          strokeDashoffset: { duration: 0.9, ease: "easeInOut" },
          opacity: { duration: 0.18 },
        }}
        style={{
          filter: `drop-shadow(0 0 6px ${glow})`,
          // vector-effect prevents the stroke from stretching with the box
          // when preserveAspectRatio="none" scales the viewBox axes
          // independently — the outline draws on a rectangle, the STROKE
          // stays a stroke.
          vectorEffect: "non-scaling-stroke",
        }}
      />
    </motion.svg>
  );
}

/**
 * The label plate. Same silhouette as MoveNamePlate and the overlay plates —
 * a skewed coloured bar with white uppercase black text — plus the same
 * cross-fade entrance MoveNamePlate uses, so the ceremonies feel of a piece
 * with everything else the board says over itself.
 */
function Plate({
  label,
  from,
  to,
  glow,
  phase,
}: {
  label: string;
  from: string;
  to: string;
  glow: string;
  phase: BeatPhase;
}) {
  // Drift on `act`, hold on `settle`, so the plate rides the same phase
  // clock every other plate does.
  const drift = phase === "settle" ? -6 : 0;
  return (
    <motion.div
      initial={{ y: 8 }}
      animate={{ y: drift }}
      transition={{ duration: 0.9, ease: "linear" }}
    >
      <div className="relative flex items-center justify-center">
        <motion.div
          aria-hidden
          className="absolute inset-y-0 -inset-x-2"
          style={{
            background: `linear-gradient(100deg, ${from}, ${to})`,
            transform: "skewX(-13deg)",
            boxShadow: `0 6px 22px ${glow}`,
            borderRadius: 3,
          }}
          initial={{ x: "-135%", opacity: 0, scaleX: 0.55 }}
          animate={{ x: "0%", opacity: 1, scaleX: 1 }}
          exit={{ x: "150%", opacity: 0, scaleX: 0.7 }}
          transition={{ duration: 0.42, ease: [0.4, 0, 0.2, 1] }}
        />
        <motion.span
          className="relative select-none whitespace-nowrap px-4 py-1.5 font-black uppercase leading-none text-white"
          style={{
            fontSize: "clamp(11px, 1.9vw, 20px)",
            letterSpacing: "0.06em",
            textShadow: "0 1px 3px rgba(0,0,0,0.55)",
          }}
          initial={{ x: "115%", opacity: 0 }}
          animate={{ x: "0%", opacity: 1 }}
          exit={{ x: "-130%", opacity: 0 }}
          transition={{ duration: 0.42, ease: [0.4, 0, 0.2, 1] }}
        >
          {label}
        </motion.span>
      </div>
    </motion.div>
  );
}
