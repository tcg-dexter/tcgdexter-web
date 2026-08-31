"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { onMovePlate, type FxMovePlate } from "./fxBus";
import type { Beat } from "@/lib/replay2/beats";
import type { BeatPhase } from "../director/choreography";

/**
 * The name of the move being used, on the mat of the player using it.
 *
 * Until this existed the board showed damage arriving without ever saying what
 * caused it — the thread beside it had the answer, but reading the thread is
 * exactly what watching the board is meant to replace. This is the caption.
 *
 * Timed against the blow rather than against itself: it enters on the beat's
 * `act` phase, so by `impact` — when the damage counter lands on the other
 * mat — it is fully on screen and drifting. The two read as one event because
 * the director is driving both from the same phase clock.
 *
 * One plate per ACTION, not per frame. Some actions are drawn across several
 * frames: `buildReplayPayload` expands a pay-cards-to-get-cards exchange into
 * a play / discard / draw trio sharing one actionIndex, which is how a Trade
 * or an Ultra Ball reaches the board. Each of those frames runs its own short
 * continuation beat, so the phase clock returns to `act` on every one of
 * them — and a plate whose visibility keyed off the phase alone flickered out
 * and back in three times for a single ability. It holds through `settle` for
 * as long as more frames of the same action are still to come.
 */

interface PlateState extends FxMovePlate {
  /** Mat box in stage-local coordinates, converted once on arrival. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export function MoveNamePlate({
  beat,
  phase,
  actionContinues,
  exchangeActor,
  reducedMotion,
}: {
  beat: Beat | null;
  phase: BeatPhase;
  /** The next frame is another beat of this same action — so this `settle`
   *  is a pause inside the move, not the end of it. */
  actionContinues: boolean;
  /** The mat currently showing a card-exchange overlay (a discard-then-draw,
   *  a mulligan reveal), if any. Those cover the middle of the mat, which is
   *  where the plate otherwise sits. */
  exchangeActor: "player" | "opponent" | null;
  reducedMotion: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [plate, setPlate] = useState<PlateState | null>(null);

  useEffect(() => {
    if (reducedMotion) return;
    return onMovePlate((p) => {
      const host = hostRef.current;
      if (!host) return;
      const r = host.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      // Divide out whatever the camera is doing, the same way the FX canvas
      // does: the host is inside the camera transform, so its on-screen rect
      // and its layout size differ by exactly the current scale.
      const sx = host.offsetWidth / r.width;
      const sy = host.offsetHeight / r.height;
      setPlate({
        ...p,
        x: (p.matLeft - r.left) * sx,
        y: (p.matTop - r.top) * sy,
        w: p.matWidth * sx,
        h: p.matHeight * sy,
      });
    });
  }, [reducedMotion]);

  // On screen for the action it belongs to, and off again once that action is
  // genuinely finished — which is the last frame's `settle`, not every
  // frame's. Driving the exit off the phase rather than a timeout keeps it
  // locked to the director: at 0.5x it lingers with the blow, at 4x it leaves
  // with it.
  const visible =
    plate != null &&
    !reducedMotion &&
    beat != null &&
    beat.actionIndex === plate.actionIndex &&
    (phase !== "settle" || actionContinues);

  // A discard-then-draw or a mulligan reveal fills the middle of the mat with
  // cards. Rather than sit on top of them, the plate moves to the top edge and
  // becomes a pill there — out of the way, still legible, and its own shape
  // says the mat is busy underneath.
  const island = plate != null && exchangeActor === plate.actor;

  const accent =
    plate?.kind === "ability"
      ? { from: "#0891b2", to: "#22d3ee", glow: "rgba(34,211,238,0.55)" }
      : { from: "#b91c1c", to: "#f97316", glow: "rgba(249,115,22,0.6)" };

  // Scaled off the card it belongs to, with a floor so a small board still
  // produces readable text.
  const base = plate ? Math.max(10, Math.round(plate.cardWidth * 0.17)) : 12;
  const fontSize = island ? Math.max(9, Math.round(base * 0.86)) : base;
  const padX = fontSize * (island ? 1.15 : 0.85);
  const padY = fontSize * (island ? 0.45 : 0.4);

  return (
    <div ref={hostRef} className="pointer-events-none absolute inset-0 z-40">
      {plate && (
        // A plain wrapper does the anchoring, with a static CSS transform.
        // The centring cannot live on the motion element: framer-motion
        // composes `transform` itself from x/y, so it would be overwritten
        // the moment the drift animates.
        <div
          className="absolute"
          style={
            island
              ? {
                  left: plate.x + plate.w / 2,
                  top: plate.y + fontSize * 0.9,
                  transform: "translate(-50%, 0)",
                }
              : {
                  left: plate.x + plate.w / 2,
                  top: plate.y + plate.h / 2,
                  transform: "translate(-50%, -50%)",
                }
          }
        >
          <AnimatePresence>
            {visible && (
              <motion.div
                key={plate.actionIndex}
                // Drifts while it holds — slowly, and still moving when it
                // leaves. Smaller in island mode, which is meant to sit still
                // the way a status chip does.
                initial={{ y: 0 }}
                animate={{ y: island ? -fontSize * 0.2 : -fontSize * 0.75 }}
                exit={{
                  y: island ? -fontSize * 0.5 : -fontSize * 1.3,
                  transition: { duration: 0.42, ease: "easeIn" },
                }}
                transition={{ duration: 1.2, ease: "linear" }}
              >
                <div className="relative flex items-center justify-center">
                  {/* Background: sweeps in from the left and keeps going, out
                      to the right. Skewed into a swipe of colour on the mat;
                      a rounded pill in island mode. */}
                  <motion.div
                    className="absolute inset-y-0 -inset-x-2"
                    style={{
                      background: `linear-gradient(100deg, ${accent.from}, ${accent.to})`,
                      transform: island ? undefined : "skewX(-13deg)",
                      boxShadow: `0 4px 18px ${accent.glow}`,
                      borderRadius: island ? 999 : 3,
                    }}
                    initial={{ x: "-135%", opacity: 0, scaleX: 0.55 }}
                    animate={{ x: "0%", opacity: 1, scaleX: 1 }}
                    exit={{ x: "150%", opacity: 0, scaleX: 0.7 }}
                    transition={{ duration: 0.42, ease: [0.4, 0, 0.2, 1] }}
                  />
                  {/* Text: comes the other way and leaves the other way, so
                      the two cross through each other at both ends. */}
                  <motion.span
                    className="relative select-none whitespace-nowrap font-black uppercase leading-none text-white"
                    style={{
                      fontSize,
                      padding: `${padY}px ${padX}px`,
                      letterSpacing: "0.06em",
                      textShadow: "0 1px 3px rgba(0,0,0,0.55)",
                    }}
                    initial={{ x: "115%", opacity: 0 }}
                    animate={{ x: "0%", opacity: 1 }}
                    exit={{ x: "-130%", opacity: 0 }}
                    transition={{ duration: 0.42, ease: [0.4, 0, 0.2, 1] }}
                  >
                    {plate.label}
                  </motion.span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
