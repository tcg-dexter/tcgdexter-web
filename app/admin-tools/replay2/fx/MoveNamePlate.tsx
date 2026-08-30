"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { onMovePlate, type FxMovePlate } from "./fxBus";
import type { Beat } from "@/lib/replay2/beats";
import type { BeatPhase } from "../director/choreography";

/**
 * The name of the move being used, over the card using it.
 *
 * Until now the board showed damage arriving without ever saying what caused
 * it — the thread beside it had the answer, but reading the thread is exactly
 * what watching the board is meant to replace. This is the caption.
 *
 * Timed against the blow rather than against itself: it enters on the beat's
 * `act` phase, so by `impact` — when the damage counter lands on the other
 * mat — it is fully on screen and drifting. The two read as one event because
 * the director is driving both from the same phase clock.
 */

interface PlateState extends FxMovePlate {
  /** Stage-local position, converted once on arrival. */
  x: number;
  y: number;
  /** Host height at conversion time. The plate is anchored by its BOTTOM
   *  edge — see the render — which needs the height to work from. */
  hostH: number;
}

export function MoveNamePlate({
  beat,
  phase,
  reducedMotion,
}: {
  beat: Beat | null;
  phase: BeatPhase;
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
        x: (p.clientX - r.left) * sx,
        y: (p.clientY - r.top) * sy,
        hostH: host.offsetHeight,
      });
    });
  }, [reducedMotion]);

  // On screen for the action it belongs to, and only for the phases where the
  // move is actually happening. Driving the exit off the phase rather than a
  // timeout keeps it locked to the director: at 0.5x it lingers with the
  // blow, at 4x it leaves with it.
  const visible =
    plate != null &&
    !reducedMotion &&
    beat != null &&
    beat.actionIndex === plate.actionIndex &&
    (phase === "act" || phase === "impact");

  const accent =
    plate?.kind === "ability"
      ? { from: "#0891b2", to: "#22d3ee", glow: "rgba(34,211,238,0.55)" }
      : { from: "#b91c1c", to: "#f97316", glow: "rgba(249,115,22,0.6)" };

  // Scaled off the card it belongs to, with a floor so a small board still
  // produces readable text.
  const fontSize = plate ? Math.max(10, Math.round(plate.cardWidth * 0.17)) : 12;
  const padX = fontSize * 0.85;
  const padY = fontSize * 0.4;

  return (
    // No overflow-hidden. The plate hangs above the card that owns it, and a
    // bench Pokémon on the top mat sits at the very top of the board — its
    // plate belongs above the board, not trimmed to it. Nothing needs the
    // clip: the sweep distances below are percentages of the plate's own
    // width, so they stay local however near an edge it lands.
    <div ref={hostRef} className="pointer-events-none absolute inset-0 z-40">
      <AnimatePresence>
        {visible && plate && (
          <motion.div
            key={plate.actionIndex}
            className="absolute"
            style={{
              left: plate.x,
              // Anchored by its BOTTOM edge, so it sits above the card
              // without having to know its own height. The obvious
              // alternative — top plus translate(-100%) — cannot work here:
              // framer-motion composes the `transform` property itself from
              // x/y, so any transform set in `style` is overwritten the
              // moment the drift animates.
              bottom: plate.hostH - plate.y + fontSize * 1.1,
            }}
            // Horizontal centring rides along as a framer value for the same
            // reason, and holds at -50% through every state.
            //
            // The drift: slow, upward, and still moving when it leaves.
            initial={{ x: "-50%", y: 0 }}
            animate={{ x: "-50%", y: -fontSize * 0.75 }}
            exit={{
              x: "-50%",
              y: -fontSize * 1.3,
              transition: { duration: 0.42, ease: "easeIn" },
            }}
            transition={{ duration: 1.2, ease: "linear" }}
          >
            <div className="relative flex items-center justify-center">
              {/* Background: sweeps in from the left and keeps going, out to
                  the right. Skewed so it reads as a swipe of colour rather
                  than a label that happens to have a background. */}
              <motion.div
                className="absolute inset-y-0 -inset-x-2"
                style={{
                  background: `linear-gradient(100deg, ${accent.from}, ${accent.to})`,
                  transform: "skewX(-13deg)",
                  boxShadow: `0 4px 18px ${accent.glow}`,
                  borderRadius: 3,
                }}
                initial={{ x: "-135%", opacity: 0, scaleX: 0.55 }}
                animate={{ x: "0%", opacity: 1, scaleX: 1 }}
                exit={{ x: "150%", opacity: 0, scaleX: 0.7 }}
                transition={{ duration: 0.42, ease: [0.4, 0, 0.2, 1] }}
              />
              {/* Text: comes the other way and leaves the other way, so the
                  two cross through each other at both ends. */}
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
  );
}
