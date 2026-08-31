"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { onDrawFlight, type FxDrawFlight } from "./fxBus";
import { CARD_BACK_URL } from "../BoardKit2";
import type { Beat } from "@/lib/replay2/beats";
import type { BeatPhase } from "../director/choreography";
import type { HandCard, ReplayFrame } from "@/lib/replay/frames";

/**
 * A card leaving the deck.
 *
 * Drawing happens more than anything else in a game and had no physical
 * account of itself: the deck's count went down, the hand's went up, and
 * nothing travelled between them. The board's busiest event was the one it
 * never showed.
 *
 * Three beats, driven by the director's phases rather than timers of its own,
 * so the flight stays locked to playback speed:
 *
 *   act     the card lifts off the deck and turns toward the viewer
 *   impact  (named draws only) it hangs face-up over the dimmed mat
 *   settle  it lands — into the hand for the player, up and out of frame past
 *           the top of the mat for the opponent, whose hand isn't on screen
 *
 * An unnamed draw has no `impact` phase in its choreography at all, so it
 * simply passes through the middle and away — face-down, because nobody saw
 * what it was.
 */

interface FlightState extends FxDrawFlight {
  /** Stage-local geometry, converted once on arrival. */
  pileX: number;
  pileY: number;
  matX: number;
  matY: number;
  matW: number;
  matH: number;
}

/** How many cards are drawn at once before the fan stops adding to the
 *  picture. An opening hand of seven fits; anything larger is a Hilda or a
 *  Lillie's Determination and reads as "a lot" either way. */
const MAX_SHOWN = 7;

export function DrawFlight({
  beat,
  phase,
  frame,
  reducedMotion,
  onLanded,
  onStarted,
}: {
  beat: Beat | null;
  phase: BeatPhase;
  frame: ReplayFrame | null;
  reducedMotion: boolean;
  /**
   * Fired the moment the cards finish arriving.
   *
   * The hand holds them back until this lands. A drawn card is in the frame's
   * hand from the instant the action resolves, so without a handoff the same
   * card is on screen twice — mid-flight and already sitting in the hand it is
   * flying toward. This is the signal that lets exactly one of them exist at a
   * time.
   */
  onLanded?: (actionIndex: number) => void;
  /**
   * Fired when a flight is accepted and about to render.
   *
   * The hand only holds cards back once this says there is something carrying
   * them. Without it, any reason the flight failed to start — a host not yet
   * measurable, a mat that reported nothing — would hide the drawn cards from
   * the hand with no animation to account for them, and they would simply be
   * missing. Failing back to "briefly in two places" is much cheaper than
   * failing to "nowhere at all".
   */
  onStarted?: (actionIndex: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [flight, setFlight] = useState<FlightState | null>(null);
  const [landedFor, setLandedFor] = useState<number | null>(null);
  // Read through a ref so the subscription isn't torn down and rebuilt every
  // time the parent re-renders with a new callback identity — it would drop
  // emits that land in the gap.
  const onStartedRef = useRef(onStarted);
  onStartedRef.current = onStarted;

  useEffect(() => {
    if (reducedMotion) return;
    return onDrawFlight((d) => {
      const host = hostRef.current;
      if (!host) return;
      const r = host.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      // Divide out the camera, exactly as the FX canvas and the name plate do.
      const sx = host.offsetWidth / r.width;
      const sy = host.offsetHeight / r.height;
      onStartedRef.current?.(d.actionIndex);
      setFlight({
        ...d,
        pileX: (d.pileLeft - r.left + d.pileWidth / 2) * sx,
        pileY: (d.pileTop - r.top + d.pileHeight / 2) * sy,
        matX: (d.matLeft - r.left) * sx,
        matY: (d.matTop - r.top) * sy,
        matW: d.matWidth * sx,
        matH: d.matHeight * sy,
      });
    });
  }, [reducedMotion]);

  const active =
    flight != null &&
    !reducedMotion &&
    beat != null &&
    beat.actionIndex === flight.actionIndex;

  /**
   * The faces to show, taken from the frame's hand rather than from the beat.
   *
   * The beat names the cards but carries no art, and resolving names to images
   * in the browser would mean shipping the card catalog to it. The engine
   * pushes drawn cards onto the end of the hand, so the last N hand cards are
   * exactly the ones that just arrived — and they already carry resolved art
   * because the board needs it for the hand strip anyway.
   *
   * Read from whichever side drew, NOT from the player's hand. It is tempting
   * to assume the player is the one with real cards, and it is wrong: the log
   * names the draws of whoever exported it, and that account is not always the
   * side the payload is normalized to. In example-1 it is the opponent whose
   * draws are named. Each HandCard carries its own `revealed` flag, so
   * deferring to that gets both cases right and needs no rule about sides.
   */
  const faces: (HandCard | null)[] = (() => {
    if (!flight || !frame) return [];
    const n = Math.min(flight.count, MAX_SHOWN);
    if (!flight.revealed) return Array.from({ length: n }, () => null);
    const hand = flight.actor === "player" ? frame.player.hand : frame.opponent.hand;
    const drawn = hand.slice(Math.max(0, hand.length - flight.count));
    return Array.from({ length: n }, (_, i) => drawn[i] ?? null);
  })();

  // NOTE: no early return before the host element below.
  //
  // The subscriber measures `hostRef` to convert client coordinates into the
  // stage's, so the host has to be in the DOM before the first flight arrives.
  // Returning null while there is nothing to draw meant the ref was always
  // null when an emit landed, the handler bailed, state never updated, and the
  // host never rendered — the animation could not start even once.
  const ready = flight != null && faces.length > 0;

  const w = ready ? Math.max(28, Math.round(flight!.cardWidth * 0.86)) : 0;
  const h = w * (342 / 245);
  const midX = ready ? flight!.matX + flight!.matW / 2 : 0;
  const midY = ready ? flight!.matY + flight!.matH / 2 : 0;
  // The player's hand sits under the board; the opponent's is off screen
  // entirely, so their cards leave past the top of their own mat.
  const endY = !ready
    ? 0
    : flight!.actor === "player"
      ? flight!.matY + flight!.matH + h * 0.9
      : flight!.matY - h * 1.1;
  const fan = ready
    ? Math.min(w * 0.72, (flight!.matW * 0.8) / Math.max(1, faces.length))
    : 0;
  const landed = ready && landedFor === flight!.actionIndex;
  const showScrim = ready && active && !landed && flight!.revealed && phase === "impact";

  return (
    <div ref={hostRef} className="pointer-events-none absolute inset-0 z-[35]">
      {/* The same dimming the discard/draw exchange overlay uses — 90% of the
          page background rather than a black scrim, so it reads as the app
          quieting the mat rather than a modal over it. */}
      <AnimatePresence>
        {showScrim && (
          <motion.div
            key={`${flight!.actionIndex}-scrim`}
            className="absolute rounded-xl"
            style={{
              left: flight!.matX,
              top: flight!.matY,
              width: flight!.matW,
              height: flight!.matH,
              backgroundColor: "color-mix(in srgb, var(--bg) 90%, transparent)",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {ready &&
          active &&
          !landed &&
          faces.map((card, i) => {
            const offset = (i - (faces.length - 1) / 2) * fan;
            const landing = phase === "settle";
            return (
              <motion.div
                key={`${flight!.actionIndex}-${i}`}
                className="absolute"
                style={{
                  width: w,
                  height: h,
                  transformStyle: "preserve-3d",
                  // Without a perspective the rotateY below just squashes the
                  // card horizontally; with one it turns.
                  transformPerspective: Math.max(600, w * 9),
                }}
                // Starts on the deck: small, and turned away from the viewer.
                initial={{
                  left: flight!.pileX - w / 2,
                  top: flight!.pileY - h / 2,
                  scale: 0.55,
                  rotateY: 180,
                  opacity: 0,
                }}
                animate={
                  landing
                    ? {
                        left: midX + offset - w / 2,
                        top: endY - h / 2,
                        scale: 0.7,
                        rotateY: 0,
                        // Arrives solid. It used to fade out on the way down,
                        // which read as the card evaporating short of the hand
                        // — and the hand had already been showing it the whole
                        // time anyway, so nothing looked handed over.
                        opacity: 1,
                      }
                    : {
                        left: midX + offset - w / 2,
                        top: midY - h / 2,
                        scale: 1,
                        rotateY: 0,
                        opacity: 1,
                      }
                }
                exit={{ opacity: 0, transition: { duration: 0.18 } }}
                onAnimationComplete={() => {
                  // Only the last card of the fan, and only on the leg that
                  // ends in the hand — this fires for the flight out of the
                  // deck too, which is not the moment the hand should fill.
                  if (!landing || i !== faces.length - 1) return;
                  setLandedFor(flight!.actionIndex);
                  onLanded?.(flight!.actionIndex);
                }}
                transition={{
                  // Staggered so a seven-card opening hand deals rather than
                  // arriving as one block.
                  delay: landing ? i * 0.03 : i * 0.05,
                  type: "spring",
                  stiffness: landing ? 200 : 260,
                  damping: 30,
                  mass: 0.8,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={(card?.revealed ? card.imageUrl : null) ?? CARD_BACK_URL}
                  alt=""
                  className="h-full w-full rounded object-cover shadow-[0_10px_26px_rgba(0,0,0,0.4)]"
                  // Deliberately NOT backface-hidden. This is one image being
                  // turned, not a two-sided card: hiding the backface would
                  // make it invisible for the whole first half of the spin,
                  // which is exactly the half where it is leaving the deck.
                  onError={(e) => {
                    if (e.currentTarget.src !== CARD_BACK_URL) {
                      e.currentTarget.src = CARD_BACK_URL;
                    }
                  }}
                />
              </motion.div>
            );
          })}
      </AnimatePresence>
    </div>
  );
}
