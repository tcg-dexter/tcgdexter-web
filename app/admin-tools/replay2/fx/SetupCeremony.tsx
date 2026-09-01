"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";
import type { Beat } from "@/lib/replay2/beats";
import type { BeatPhase } from "../director/choreography";
import { emitFx } from "./fxBus";

/**
 * The ceremonies that open a game — the coin flip that decides turn order,
 * and the announcement of who chose to go first.
 *
 * Setup used to play out over an empty board. The coin flip was pure narration
 * in the thread and the "player X goes first" line landed with nothing on
 * screen to acknowledge it, so a viewer scrubbing past the first ten seconds
 * of a match saw nothing at all until the opening hand arrived. These are
 * the two moments where the game leaves the abstract and becomes THIS game,
 * between these two people — an occasion, on the same terms as game_end at
 * the other end of the match.
 *
 * Board-level rather than per-mat: neither is about a card, and the coin
 * doesn't belong to either player. The first-player call is anchored to the
 * winner's mat edge (top or bottom) rather than centred so the board itself
 * says who — the same trick GameEndFlourish uses at the end of the game.
 */

interface Props {
  beat: Beat | null;
  phase: BeatPhase;
  reducedMotion: boolean;
  /** Which visual half the first-player call belongs to, when there is one. */
  firstPlayerEdge: "top" | "bottom" | null;
  /** Handle to name in the first-player call. */
  firstPlayerName: string | null;
}

export function SetupCeremony({
  beat,
  phase,
  reducedMotion,
  firstPlayerEdge,
  firstPlayerName,
}: Props) {
  return (
    <>
      <CoinFlip beat={beat} phase={phase} reducedMotion={reducedMotion} />
      <FirstPlayerCall
        beat={beat}
        phase={phase}
        reducedMotion={reducedMotion}
        edge={firstPlayerEdge}
        name={firstPlayerName}
      />
    </>
  );
}

/* ──────────────────────────────────────────────────────────────── */
/* Coin flip                                                        */
/* ──────────────────────────────────────────────────────────────── */

/**
 * A physical coin, spinning end-over-end on the Y axis.
 *
 * Two faces baked as CSS gradients rather than art: a coin is a shape more
 * than a picture, and shipping a real Poké Ball or minted image would tie the
 * ceremony to a single visual — this is more likely to feel like the app's
 * own coin. Heads is the site's brand red, tails is a cooler slate, and the
 * label reads exactly what the log said the choice was, so the ceremony still
 * tells the truth even when the log chose an unusual word.
 *
 * The spin runs through anticipate + impact, decelerating into the settle
 * phase — its own timing rather than framer's default because the whole point
 * of a coin flip is the moment it stops.
 */
function CoinFlip({
  beat,
  phase,
  reducedMotion,
}: {
  beat: Beat | null;
  phase: BeatPhase;
  reducedMotion: boolean;
}) {
  const active = beat?.kind === "coin_flip";
  const spinning = active && (phase === "anticipate" || phase === "impact");
  const landed = active && phase === "settle";
  const choice = beat?.kind === "coin_flip" ? beat.choice : null;

  // A single burst on landing, timed to the coin actually stopping. Ref-guarded
  // so a held phase doesn't re-fire every render.
  const firedRef = useRef<number | null>(null);
  useEffect(() => {
    if (!landed || reducedMotion) return;
    if (firedRef.current === beat?.actionIndex) return;
    firedRef.current = beat?.actionIndex ?? null;
    // Centred on the viewport rather than measured — the coin is fixed at
    // 50%/50% of the stage, and a stage bounds lookup would cost a ref just
    // to arrive at the same answer.
    emitFx({
      kind: "spark",
      clientX: window.innerWidth / 2,
      clientY: window.innerHeight / 2,
      intensity: 1.4,
      color: "#fde68a",
    });
  }, [landed, reducedMotion, beat?.actionIndex]);

  return (
    <AnimatePresence>
      {active && !reducedMotion && (
        <motion.div
          key={`coin-${beat!.actionIndex}`}
          className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* A dim wash so the coin reads against the mats behind it,
              without hiding them — the ceremony belongs OVER the board it
              is about, not in front of a blank curtain. */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background: "color-mix(in srgb, var(--bg) 55%, transparent)",
            }}
          />
          <div
            style={{
              perspective: 900,
              width: "min(28vw, 180px)",
              aspectRatio: "1 / 1",
            }}
          >
            <motion.div
              className="relative h-full w-full"
              style={{ transformStyle: "preserve-3d" }}
              // Six full turns during the spin, then one more slow one into
              // settle — total is the whole beat, so the coin is turning
              // through every ms it is on screen.
              animate={{
                rotateY: spinning ? [0, 2160] : landed ? 2520 : 0,
                scale: landed ? [1, 1.08, 1] : 1,
              }}
              transition={
                spinning
                  ? { duration: 0.56, ease: "linear" }
                  : landed
                    ? {
                        rotateY: { duration: 0.42, ease: [0.16, 1, 0.3, 1] },
                        scale: { duration: 0.42, times: [0, 0.5, 1] },
                      }
                    : { duration: 0.2 }
              }
            >
              {/* Heads. */}
              <CoinFace facing="front" tint="warm" label={choice ?? "heads"} />
              {/* Tails, pre-rotated so the SAME element is drawn on both sides
                  of the same coin rather than two separate elements — that is
                  what backface-visibility makes possible, and it is what keeps
                  the coin thick-looking rather than flat. */}
              <CoinFace facing="back" tint="cool" label={choice ?? "tails"} />
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function CoinFace({
  facing,
  tint,
  label,
}: {
  facing: "front" | "back";
  /** Which of the two disc gradients this face wears. */
  tint: "warm" | "cool";
  label: string;
}) {
  const gradient =
    tint === "warm"
      ? "radial-gradient(circle at 32% 30%, #ffe3a0 0%, #f4b34a 45%, #b46612 100%)"
      : "radial-gradient(circle at 32% 30%, #dbe7f0 0%, #7a94a8 55%, #2f3f4d 100%)";
  return (
    <div
      className="absolute inset-0 flex items-center justify-center rounded-full"
      style={{
        background: gradient,
        boxShadow:
          "inset 0 0 10px rgba(0,0,0,0.28), 0 12px 26px rgba(0,0,0,0.42)",
        backfaceVisibility: "hidden",
        transform: facing === "front" ? undefined : "rotateY(180deg)",
        // A thin rim of a slightly darker shade of the same tint, so the coin
        // has an edge instead of ending on the shadow. Painted with a second
        // background layered under the disc.
        border: `2px solid ${tint === "warm" ? "#8a4712" : "#22303c"}`,
      }}
    >
      <span
        className="select-none font-black uppercase tracking-[0.14em] text-white"
        style={{
          fontSize: "clamp(11px, 2.6vw, 20px)",
          textShadow: "0 2px 6px rgba(0,0,0,0.5)",
        }}
      >
        {label}
      </span>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────── */
/* Chose first                                                      */
/* ──────────────────────────────────────────────────────────────── */

/**
 * The winner of the flip declares. Their mat's half of the board catches
 * light and their name lands with "GOES FIRST" — same shape as the game-end
 * flourish, quieter, and never announced until it happens.
 *
 * The half-mat wash is on their edge specifically rather than the whole
 * board, so the visual claim is unmistakable in a way the label alone would
 * not be — two identical name banners at the beginning and end of a game
 * would land differently only for someone who was watching for them.
 */
function FirstPlayerCall({
  beat,
  phase,
  reducedMotion,
  edge,
  name,
}: {
  beat: Beat | null;
  phase: BeatPhase;
  reducedMotion: boolean;
  edge: "top" | "bottom" | null;
  name: string | null;
}) {
  const active =
    beat?.kind === "chose_first" &&
    edge != null &&
    phase !== "anticipate";
  return (
    <AnimatePresence>
      {active && !reducedMotion && (
        <motion.div
          key={`first-${beat!.actionIndex}`}
          className="pointer-events-none absolute inset-0 z-40 overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          <motion.div
            className="absolute inset-x-0"
            style={{
              [edge!]: 0,
              height: "50%",
              background:
                edge === "bottom"
                  ? "linear-gradient(to top, rgba(255,238,170,0.42), transparent 82%)"
                  : "linear-gradient(to bottom, rgba(255,238,170,0.42), transparent 82%)",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0.6] }}
            transition={{ duration: 0.9, ease: "easeOut" }}
          />
          {name && (
            <motion.div
              className="absolute inset-0 flex items-center justify-center"
              initial={{ opacity: 0, scale: 1.16 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 22, delay: 0.12 }}
            >
              <span
                className="select-none px-3 text-center font-black uppercase tracking-[0.18em] text-white"
                style={{
                  fontSize: "clamp(12px, 2.6vw, 26px)",
                  textShadow: "0 3px 14px rgba(0,0,0,0.85), 0 0 34px rgba(255,214,102,0.65)",
                }}
              >
                {name} <span className="opacity-80">goes first</span>
              </span>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
