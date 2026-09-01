"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { Beat } from "@/lib/replay2/beats";
import type { BeatPhase } from "../director/choreography";
import { useBeat } from "../director/BeatContext";

/**
 * The setup ceremonies — the coin call, the toss result, and the go-first
 * decision. Each is one mat lit up on its own half of the board, a stroked
 * outline drawn around that mat, and a plate over it naming what just
 * happened.
 *
 * Rendered in two places rather than one:
 *
 *   SetupMatBorder    inline inside each mat wrapper. Draws the outline
 *                     against the mat's own box, so the stroke traces the
 *                     mat's actual edge rather than an approximation of it.
 *                     (Before this, the stroke was a rectangle sized to half
 *                     the camera stage — close, but it included the space
 *                     the mat tab tucks into, and read a beat too tall.)
 *
 *   SetupCeremony     at board level. The wash on the winner's half and
 *                     the plate carrying the label — both belong to the
 *                     ceremony as a whole, not to any card, and the wash in
 *                     particular has to reach past the mat's own edge to
 *                     read as light gathering ON the mat rather than
 *                     painted onto it.
 *
 * Three beats now, one per line the log actually carries — the caller's
 * call, the winner's win, and the winner's turn-order pick. Each fires on a
 * distinct beat, each on the matching player's mat.
 */

/* ──────────────────────────────────────────────────────────────── */
/* Which beat lights which mat, and how                             */
/* ──────────────────────────────────────────────────────────────── */

type SpotlightColorway = "cool" | "warm";

interface Spotlight {
  colorway: SpotlightColorway;
  /** Board-level plate text. */
  label: string;
}

/**
 * Read the current beat as a spotlight for a given actor. Returns null if
 * the beat isn't a setup ceremony, doesn't concern this actor, or has no
 * name to name.
 *
 * Cool for the call (a call is neutral, not a win); warm gold for the
 * winner's own moments (the toss result and the turn-order pick), the same
 * gold GameEndFlourish uses on the winning half at the other end of the
 * match.
 */
function spotlightFor(
  beat: Beat | null,
  actor: "player" | "opponent",
  handles: { player: string | null; opponent: string | null },
): Spotlight | null {
  if (!beat || beat.actor !== actor) return null;
  const name = handles[actor];
  if (!name) return null;
  if (beat.kind === "coin_flip" && beat.stage === "call") {
    const call = (beat.choice ?? "").toLowerCase();
    const choice = call === "heads" || call === "tails" ? call : "the coin";
    return { colorway: "cool", label: `${name} calls ${choice}` };
  }
  if (beat.kind === "coin_flip" && beat.stage === "won") {
    return { colorway: "warm", label: `${name} won the toss` };
  }
  if (beat.kind === "chose_first") {
    // The actor of chose_first is the toss winner — they are the one who
    // just decided. Their choice tells us the ordinal: if they picked
    // themselves as firstPlayer they go 1st, otherwise 2nd.
    if (beat.firstPlayer == null) return null;
    const ordinal = beat.firstPlayer === beat.actor ? "1st" : "2nd";
    return { colorway: "warm", label: `${name} will go ${ordinal}` };
  }
  return null;
}

/* ──────────────────────────────────────────────────────────────── */
/* Board-level: wash + plate                                        */
/* ──────────────────────────────────────────────────────────────── */

export function SetupCeremony({
  beat,
  phase,
  reducedMotion,
  playerHandle,
  opponentHandle,
}: {
  beat: Beat | null;
  phase: BeatPhase;
  reducedMotion: boolean;
  /** Handles read from the frame — passed in rather than looked up here so
   *  the ceremony stays a plain data → visual mapping. */
  playerHandle: string | null;
  opponentHandle: string | null;
}) {
  const handles = { player: playerHandle, opponent: opponentHandle };
  // The ceremony belongs to whichever mat the beat's actor sits on: the
  // submitting player is pinned to the bottom mat, the opponent to the top.
  const active = (() => {
    if (!beat) return null;
    if (beat.kind !== "coin_flip" && beat.kind !== "chose_first") return null;
    if (beat.actor !== "player" && beat.actor !== "opponent") return null;
    const spot = spotlightFor(beat, beat.actor, handles);
    if (!spot) return null;
    const edge: "top" | "bottom" = beat.actor === "player" ? "bottom" : "top";
    return { ...spot, edge, actionIndex: beat.actionIndex };
  })();

  return (
    <AnimatePresence>
      {active && !reducedMotion && phase !== "anticipate" && (
        <motion.div
          key={active.actionIndex}
          className="pointer-events-none absolute inset-0 z-40 overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          <SpotlightWash edge={active.edge} colorway={active.colorway} />
          <SpotlightPlate
            label={active.label}
            colorway={active.colorway}
            edge={active.edge}
            phase={phase}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SpotlightWash({
  edge,
  colorway,
}: {
  edge: "top" | "bottom";
  colorway: SpotlightColorway;
}) {
  const color =
    colorway === "warm"
      ? "rgba(255, 238, 170, 0.45)"
      : "rgba(191, 219, 254, 0.34)";
  return (
    <motion.div
      className="absolute inset-x-0"
      style={{
        [edge]: 0,
        height: "50%",
        background:
          edge === "bottom"
            ? `linear-gradient(to top, ${color}, transparent 80%)`
            : `linear-gradient(to bottom, ${color}, transparent 80%)`,
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 0.75] }}
      transition={{ duration: 0.9, ease: "easeOut" }}
    />
  );
}

function SpotlightPlate({
  label,
  colorway,
  edge,
  phase,
}: {
  label: string;
  colorway: SpotlightColorway;
  edge: "top" | "bottom";
  phase: BeatPhase;
}) {
  const from = colorway === "warm" ? "#b45309" : "#0369a1";
  const to = colorway === "warm" ? "#f59e0b" : "#22d3ee";
  const glow =
    colorway === "warm" ? "rgba(245, 158, 11, 0.6)" : "rgba(34, 211, 238, 0.55)";
  // Drift on `act`, hold on `settle`, so the plate rides the same phase
  // clock as every other plate — MoveNamePlate holds still on settle too.
  const drift = phase === "settle" ? -6 : 0;
  return (
    <div
      className="absolute inset-x-0 flex justify-center"
      style={edge === "bottom" ? { bottom: "24%" } : { top: "24%" }}
    >
      <motion.div initial={{ y: 8 }} animate={{ y: drift }} transition={{ duration: 0.9, ease: "linear" }}>
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

/* ──────────────────────────────────────────────────────────────── */
/* Inline: the mat's own border                                     */
/* ──────────────────────────────────────────────────────────────── */

/**
 * The stroked outline itself, drawn once around the mat when a setup beat
 * concerns this actor. Rendered inline INSIDE each mat's wrapper div (the
 * one that positions the mat plus its own overlays) so `absolute inset-0`
 * traces the mat's actual box — the wrapper's height is the mat's height,
 * so the SVG is on the mat, not on an approximated rectangle around it.
 *
 * The path animates its own length via pathLength=1 + strokeDashoffset,
 * the same trick ConditionBorder uses around a struck card, so the stroke
 * reads as being drawn rather than fading in.
 */
export function SetupMatBorder({
  actor,
  radius = 12,
}: {
  actor: "player" | "opponent";
  /** Corner radius. Matches the mat's own rounded-xl (12px) by default. */
  radius?: number;
}) {
  const { beat, phase, reducedMotion } = useBeat();
  const handles = { player: null, opponent: null };
  const spot = spotlightFor(beat, actor, handles);
  // Handles aren't needed to know WHETHER to light — only to name the plate,
  // which is a board-level concern. Re-run the check with sentinel handles
  // to get the colorway alone, then decide visibility from beat + phase.
  const shouldLight =
    !reducedMotion &&
    phase !== "anticipate" &&
    beat != null &&
    beat.actor === actor &&
    (beat.kind === "coin_flip" || beat.kind === "chose_first");
  const colorway =
    beat?.kind === "coin_flip" && beat.stage === "call" ? "cool" : "warm";
  const color = colorway === "warm" ? "#facc15" : "#38bdf8";
  const glow =
    colorway === "warm" ? "rgba(250, 204, 21, 0.7)" : "rgba(56, 189, 248, 0.6)";
  void spot; // spotlightFor kept in scope for a future ambient use.
  const stroke = 3;
  return (
    <AnimatePresence>
      {shouldLight && (
        <motion.svg
          key={beat!.actionIndex}
          className="pointer-events-none absolute inset-0 z-30"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ overflow: "visible" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.35 } }}
          aria-hidden
        >
          <motion.rect
            x={stroke / 2}
            y={stroke / 2}
            width={100 - stroke}
            height={100 - stroke}
            rx={radius / 4}
            ry={radius / 4}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray="1 1"
            initial={{ strokeDashoffset: 1 }}
            animate={{ strokeDashoffset: 0 }}
            transition={{ duration: 0.9, ease: "easeInOut" }}
            style={{
              filter: `drop-shadow(0 0 6px ${glow})`,
              // preserveAspectRatio="none" scales the viewBox axes
              // independently to fit the mat; vector-effect keeps the
              // stroke at a fixed pixel width instead of stretching with
              // the box, so the outline reads as an ink stroke instead of
              // a ribbon that thickens on the long edges.
              vectorEffect: "non-scaling-stroke",
            }}
          />
        </motion.svg>
      )}
    </AnimatePresence>
  );
}
