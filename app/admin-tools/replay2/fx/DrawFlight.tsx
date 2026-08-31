"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { onDrawFlight, type FxDrawFlight } from "./fxBus";
import { CardSleeve } from "../BoardKit2";
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
 * Face-down the whole way. A card is not turned over on its way out of the
 * deck — it is put in a hand, and looked at there. The earlier version held it
 * face-up over the middle of the mat first, which is a thing no player does
 * and which meant the card had to be shown twice: once presented, once in the
 * hand. Now it travels once and turns over where it lands (see the hand strip,
 * which keeps the opening seven face-down until the first turn begins).
 *
 * Two beats, driven by the director's phases rather than timers of its own, so
 * the flight stays locked to playback speed:
 *
 *   act     the card lifts off the deck
 *   settle  it goes to the hand — as the hand's OWN element, via a shared
 *           layoutId, so one card moves rather than two being swapped; or, for
 *           the opponent, up and out of frame, their hand not being on screen
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
  const onLandedRef = useRef(onLanded);
  onLandedRef.current = onLanded;

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
   * The hand slots these cards are destined for.
   *
   * Not for their art — the flight is face-down, so nothing here is drawn from
   * the card itself. It is for the ids: each flying card carries the layoutId
   * of the hand element it will become, which is what makes the landing one
   * card moving rather than two cards swapped.
   *
   * The beat names the cards but carries no art, and resolving names to images
   * in the browser would mean shipping the card catalog to it. The engine
   * pushes drawn cards onto the end of the hand, so the last N hand cards are
   * exactly the ones that just arrived — and they already carry resolved art
   * because the board needs it for the hand strip anyway.
   *
   * Read from whichever side drew rather than assuming the player: the engine
   * pushes drawn cards onto the end of that side's hand, so the last N are the
   * ones that just arrived.
   */
  const faces: (HandCard | null)[] = (() => {
    if (!flight || !frame) return [];
    const n = Math.min(flight.count, MAX_SHOWN);
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
  /**
   * Which way the cards peel off the deck: toward the middle of their own mat.
   *
   * The two mats are mirrored. The top mat keeps its draw pile at the bottom
   * left; the bottom mat keeps its at the TOP RIGHT, because each player's
   * rails run outward from the centre line. A fixed "lift upward" therefore
   * pointed into the mat on one side and straight out of it on the other,
   * where the cards climbed away from the board before turning round to reach
   * the hand.
   *
   * Aiming at the mat's own centre makes both correct by construction rather
   * than by two hard-coded cases, and stays correct if the rails ever move.
   */
  const liftLen = ready ? Math.hypot(midX - flight!.pileX, midY - flight!.pileY) || 1 : 1;
  const liftUx = ready ? (midX - flight!.pileX) / liftLen : 0;
  const liftUy = ready ? (midY - flight!.pileY) / liftLen : 0;
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
  const settling = phase === "settle";
  /**
   * Whether these cards have real hand elements to become.
   *
   * Only the player's hand is on screen, and only a named draw resolves to
   * hand cards with ids. When both hold, the flight doesn't fly to the hand
   * and dissolve — it simply stops rendering, and the hand elements that take
   * its place share its layoutId, so framer moves the very same card into the
   * strip. The opponent's cards have nothing to become and still leave frame
   * on their own.
   */
  const handoff = ready && flight!.actor === "player" && faces.some((f) => f != null);

  // The handoff moment. Retiring the flight and mounting the hand in the same
  // commit is what lets framer treat them as one element; an exit animation
  // here would keep both alive at once and turn the move into a crossfade
  // between two cards.
  const flightActionIndex = ready ? flight!.actionIndex : null;
  useEffect(() => {
    if (!active || !handoff || !settling || flightActionIndex == null) return;
    if (landedFor === flightActionIndex) return;
    setLandedFor(flightActionIndex);
    onLandedRef.current?.(flightActionIndex);
  }, [active, handoff, settling, flightActionIndex, landedFor]);

  return (
    <div ref={hostRef} className="pointer-events-none absolute inset-0 z-[35]">
      <AnimatePresence>
        {ready &&
          active &&
          !landed &&
          faces.map((card, i) => {
            const offset = (i - (faces.length - 1) / 2) * fan;
            // Only cards with nowhere to land fly out; the rest are handed to
            // the hand strip above.
            const landing = settling && !handoff;
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
                  scale: 0.8,
                  rotateY: 0,
                  opacity: 0,
                }}
                // The card that will become a hand element carries that
                // element's layoutId, so framer animates one card into the
                // strip rather than swapping two.
                layoutId={
                  handoff && card ? `hand-${card.id}` : undefined
                }
                animate={
                  landing
                    ? {
                        left: midX + offset - w / 2,
                        top: endY - h / 2,
                        scale: 0.7,
                        rotateY: 0,
                        // Leaves frame rather than landing: this branch is the
                        // opponent's draw, which has no visible hand to go to.
                        opacity: 0,
                      }
                    : {
                        // Lifted off the deck and fanned a little, still ON
                        // the deck. The journey to the hand is the
                        // shared-layout move at `settle`, not a second
                        // position here — a waypoint in the middle of the mat
                        // is exactly the presentation step this no longer
                        // does. The per-card term stacks them slightly as
                        // they peel off, in the same direction.
                        left:
                          flight!.pileX - w / 2 + liftUx * (h * 0.16 + i * 2) + offset * 0.22,
                        top: flight!.pileY - h / 2 + liftUy * (h * 0.16 + i * 2),
                        scale: 1,
                        rotateY: 0,
                        opacity: 1,
                      }
                }
                // A handoff card must leave in the same commit its hand
                // element arrives: any exit duration keeps both alive at once,
                // and two live elements sharing a layoutId crossfade instead
                // of moving. Cards leaving frame keep their fade.
                exit={
                  handoff
                    ? { opacity: 0, transition: { duration: 0 } }
                    : { opacity: 0, transition: { duration: 0.18 } }
                }
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
                  // The move into the hand is the shared-layout leg, and it
                  // is the one the eye follows — given its own spring so the
                  // card settles into the strip rather than snapping.
                  layout: { type: "spring", stiffness: 260, damping: 32, mass: 0.9 },
                }}
              >
                {/* Always face-down, and wearing the deck's own back rather
                    than the printed Pokémon one — these cards are coming off
                    that pile, and they should look like it. CardSleeve is the
                    single definition of that back, shared with the draw pile
                    and the prize stack, so changing it later changes it
                    everywhere at once. */}
                <div className="relative h-full w-full overflow-hidden rounded shadow-[0_10px_26px_rgba(0,0,0,0.4)]">
                  <CardSleeve radius={6} />
                </div>
              </motion.div>
            );
          })}
      </AnimatePresence>
    </div>
  );
}
