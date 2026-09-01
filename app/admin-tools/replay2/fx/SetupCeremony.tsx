"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { Beat } from "@/lib/replay2/beats";
import type { BeatPhase } from "../director/choreography";
import { useBeat } from "../director/BeatContext";

/**
 * The setup ceremonies — the coin call, the toss result, and the go-first
 * decision. Three beats now, each firing on the mat of the player it names,
 * as one self-contained overlay drawn ON the mat itself.
 *
 * Rendered as a single component per mat, dropped in beside the mat inside
 * its own wrapper. `absolute inset-0` inside that wrapper traces the mat's
 * actual box — everything the ceremony draws (the border stroke, the wash,
 * the plate) is confined to the mat rather than escaping onto whatever else
 * sits around it (the tab, the gap between mats, the other mat's half).
 *
 * A previous version separated the ceremony's parts: the border was inline
 * on the mat, but the wash and plate lived at board level and stretched
 * across both mats' halves of the camera stage. That made the border tight
 * to the mat but everything else too generous; the wash reached into the
 * gap the tab tucks into, and the plate floated well past the mat edge. Now
 * every piece sits on the mat, always, and only the mat the beat is about.
 */

type SpotlightColorway = "cool" | "warm";

interface Spotlight {
  colorway: SpotlightColorway;
  /** Plate text. Null lights the mat without a plate — used nowhere at the
   *  moment, kept as a return so a future ambient beat can highlight a mat
   *  without saying anything over it. */
  label: string | null;
}

function spotlightFor(
  beat: Beat | null,
  actor: "player" | "opponent",
  name: string | null,
): Spotlight | null {
  if (!beat || beat.actor !== actor) return null;
  if (!name) return null;
  if (beat.kind === "coin_flip" && beat.stage === "call") {
    // The call is neutral — no one has won yet, only chosen a side — so it
    // reads cool. Winner-only moments below take the same warm gold as
    // GameEndFlourish uses at the other end of the match.
    const call = (beat.choice ?? "").toLowerCase();
    const choice = call === "heads" || call === "tails" ? call : "the coin";
    return { colorway: "cool", label: `${name} calls ${choice}` };
  }
  if (beat.kind === "coin_flip" && beat.stage === "won") {
    return { colorway: "warm", label: `${name} won the toss` };
  }
  if (beat.kind === "chose_first") {
    if (beat.firstPlayer == null) return null;
    // The actor of chose_first is the toss winner — they are the one who
    // just decided. Whether they chose first or second is derivable: if
    // they picked themselves as firstPlayer the answer is first, otherwise
    // second. Spelled-out rather than "1st"/"2nd" — the plate reads better
    // as prose, and there is no page geometry cramped enough to need the
    // abbreviation.
    const ordinal = beat.firstPlayer === beat.actor ? "first" : "second";
    return { colorway: "warm", label: `${name} will go ${ordinal}` };
  }
  return null;
}

/**
 * The per-mat ceremony. Dropped inside each mat wrapper so its overlay is
 * confined to that mat's own box and nothing else. Reads the beat from
 * context so no props have to be threaded down for something the beat
 * clock already knows about.
 */
export function SetupMatCeremony({
  actor,
  handle,
}: {
  actor: "player" | "opponent";
  /** Player's own handle — passed in rather than looked up here so the
   *  ceremony stays a plain data → visual mapping. */
  handle: string | null;
}) {
  const { beat, phase, reducedMotion } = useBeat();
  const spot = spotlightFor(beat, actor, handle);
  const active = spot != null && !reducedMotion && phase !== "anticipate";
  return (
    <AnimatePresence>
      {active && (
        <MatOverlay
          key={beat!.actionIndex}
          colorway={spot!.colorway}
          label={spot!.label}
          phase={phase}
        />
      )}
    </AnimatePresence>
  );
}

/* ──────────────────────────────────────────────────────────────── */
/* One mat, lit up                                                  */
/* ──────────────────────────────────────────────────────────────── */

function MatOverlay({
  colorway,
  label,
  phase,
}: {
  colorway: SpotlightColorway;
  label: string | null;
  phase: BeatPhase;
}) {
  return (
    <motion.div
      className="pointer-events-none absolute inset-0 z-40 overflow-hidden rounded-xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      <MatWash colorway={colorway} />
      <MatBorder colorway={colorway} />
      {label && <MatPlate label={label} colorway={colorway} phase={phase} />}
    </motion.div>
  );
}

/**
 * A soft wash of the ceremony's colour across the mat. Radial rather than a
 * one-sided linear gradient — this overlay is confined to the mat itself,
 * not spilling into a half of the board, so the light reads better as
 * gathering ON the mat than as gathering FROM one edge.
 */
function MatWash({ colorway }: { colorway: SpotlightColorway }) {
  const color =
    colorway === "warm"
      ? "rgba(255, 238, 170, 0.42)"
      : "rgba(191, 219, 254, 0.34)";
  return (
    <motion.div
      className="absolute inset-0"
      style={{
        background: `radial-gradient(ellipse at center, ${color} 0%, transparent 78%)`,
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 0.85] }}
      transition={{ duration: 0.9, ease: "easeOut" }}
    />
  );
}

/**
 * The stroked outline itself, drawn in one continuous pass — same trick
 * ConditionBorder uses around a struck card.
 *
 * viewBox 0 0 100 100 + preserveAspectRatio="none" stretches the rectangle
 * to the mat's real aspect. vector-effect="non-scaling-stroke" then keeps
 * the STROKE a fixed pixel width, so the outline reads as an ink stroke
 * rather than a ribbon that thickens along the long edges.
 */
function MatBorder({ colorway }: { colorway: SpotlightColorway }) {
  const color = colorway === "warm" ? "#facc15" : "#38bdf8";
  const glow =
    colorway === "warm" ? "rgba(250, 204, 21, 0.7)" : "rgba(56, 189, 248, 0.6)";
  const stroke = 3;
  return (
    <svg
      className="pointer-events-none absolute inset-0"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      {/* The stroke draws in, un-draws, and draws again — a continuous
          ease-in / ease-out loop rather than one draw that lands and sits
          static waiting for the beat to end. Half-beat draw times keep the
          motion legible without feeling frantic.

          repeatType "reverse" reuses the same forward transition on the way
          back, so the ease-in of the draw becomes the ease-out of the
          un-draw for free — no separate easing curve to keep in step.

          On exit, framer stops the loop and the parent motion.div fades
          the whole overlay's opacity, so the stroke leaves with everything
          else rather than needing its own exit transition. */}
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
        initial={{ strokeDashoffset: 1 }}
        animate={{ strokeDashoffset: 0 }}
        transition={{
          duration: 1.1,
          ease: "easeInOut",
          repeat: Infinity,
          repeatType: "reverse",
        }}
        style={{
          filter: `drop-shadow(0 0 6px ${glow})`,
          vectorEffect: "non-scaling-stroke",
        }}
      />
    </svg>
  );
}

/**
 * The label plate — same silhouette as MoveNamePlate and the overlay plates
 * (skewed coloured bar, white uppercase black text, soft glow), so the
 * ceremonies feel of a piece with everything else the board says over
 * itself. Centred on the mat.
 */
function MatPlate({
  label,
  colorway,
  phase,
}: {
  label: string;
  colorway: SpotlightColorway;
  phase: BeatPhase;
}) {
  const from = colorway === "warm" ? "#b45309" : "#0369a1";
  const to = colorway === "warm" ? "#f59e0b" : "#22d3ee";
  const glow =
    colorway === "warm" ? "rgba(245, 158, 11, 0.6)" : "rgba(34, 211, 238, 0.55)";
  // Drift up during settle, the same way MoveNamePlate drifts up while it
  // holds — so both plates ride the same phase clock.
  const drift = phase === "settle" ? -6 : 0;
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <motion.div initial={{ y: 10 }} animate={{ y: drift }} transition={{ duration: 0.9, ease: "linear" }}>
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
    </div>
  );
}
