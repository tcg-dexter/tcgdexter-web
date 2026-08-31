"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { onDrawFlight, type FxDrawFlight } from "./fxBus";
import { CardSleeve } from "../BoardKit2";
import type { Beat } from "@/lib/replay2/beats";
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
 * Dealt one at a time, not as a block. Cards sit stacked on the deck and leave
 * it in quick succession — which is how a hand is actually dealt, and which
 * turns the opening seven from a single shuffle-and-appear into something with
 * a rhythm to watch. Each card goes to the hand as the hand's OWN element, via
 * a shared layoutId, so one card moves rather than two being swapped; the
 * opponent's leave up and out of frame, their hand not being on screen.
 *
 * The cadence comes from `staggerMs`, which the viewer derives from the beat's
 * own choreographed length and the playback speed, so the whole deal finishes
 * inside its beat at 0.5x and at 4x alike.
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

export function DrawFlight({
  beat,
  frame,
  reducedMotion,
  staggerMs,
  onLanded,
  onStarted,
}: {
  beat: Beat | null;
  frame: ReplayFrame | null;
  reducedMotion: boolean;
  /**
   * Real milliseconds between one card leaving the deck and the next.
   *
   * Passed in rather than chosen here because the two things that decide it
   * both live in the viewer: the beat's choreographed duration and the
   * playback speed. A deal that outran its own beat would leave cards on the
   * deck when the frame advanced, and they would arrive in the hand with no
   * flight at all.
   */
  staggerMs: number;
  /**
   * Fired the moment the cards finish arriving.
   *
   * The hand holds them back until this lands. A drawn card is in the frame's
   * hand from the instant the action resolves, so without a handoff the same
   * card is on screen twice — mid-flight and already sitting in the hand it is
   * flying toward. This is the signal that lets exactly one of them exist at a
   * time.
   */
  onLanded?: (actionIndex: number, released: number) => void;
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
  // How many cards have left the deck so far, and for which action. The hand
  // reads the same number through onLanded, which is what keeps exactly one
  // copy of each card on screen while the deal is running.
  const [release, setRelease] = useState<{ action: number; count: number }>({
    action: -1,
    count: 0,
  });
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
    const hand = flight.actor === "player" ? frame.player.hand : frame.opponent.hand;
    const drawn = hand.slice(Math.max(0, hand.length - flight.count));
    return Array.from({ length: flight.count }, (_, i) => drawn[i] ?? null);
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
  /**
   * Whether these cards have real hand elements to become.
   *
   * Only the player's hand is on screen, and only a named draw resolves to
   * hand cards with ids. When both hold, a released card doesn't fly to the
   * hand and dissolve — it simply stops rendering, and the hand element that
   * takes its place shares its layoutId, so framer moves the very same card
   * into the strip. The opponent's cards have nothing to become and leave
   * frame on their own instead.
   */
  const handoff = ready && flight!.actor === "player" && faces.some((f) => f != null);

  const flightActionIndex = ready ? flight!.actionIndex : null;
  const total = faces.length;
  const released = ready && release.action === flightActionIndex ? release.count : 0;

  /**
   * The deal itself.
   *
   * A single interval rather than one timeout per card: the cards are
   * identical in every way but their turn, and an interval is the thing that
   * can be torn down in one go when the playhead moves. Scrubbing away
   * mid-deal aborts it and the frame's own hand takes over, which is the
   * correct outcome — the state was always right, only the performance is
   * being cut short.
   */
  useEffect(() => {
    if (!active || flightActionIndex == null || total === 0) return;
    setRelease({ action: flightActionIndex, count: 0 });
    let n = 0;
    // Floored so a pathological speed or a very short beat can't turn this
    // into a busy loop; the deal simply becomes near-simultaneous.
    const step = Math.max(35, staggerMs);
    const id = setInterval(() => {
      n += 1;
      setRelease({ action: flightActionIndex, count: n });
      onLandedRef.current?.(flightActionIndex, n);
      if (n >= total) clearInterval(id);
    }, step);
    return () => clearInterval(id);
  }, [active, flightActionIndex, total, staggerMs]);

  return (
    <div ref={hostRef} className="pointer-events-none absolute inset-0 z-[35]">
      <AnimatePresence>
        {ready &&
          active &&
          faces.map((card, i) => {
            const gone = i < released;
            // A released card with a hand element waiting for it stops
            // rendering here entirely — the strip's element shares its
            // layoutId and picks the movement up, so one card travels. One
            // with nowhere to go (the opponent's) flies out of frame instead.
            if (gone && handoff) return null;
            const offset = (i - (faces.length - 1) / 2) * fan;
            return (
              <motion.div
                key={`${flight!.actionIndex}-${i}`}
                className="absolute"
                style={{
                  width: w,
                  height: h,
                  // Later cards sit under earlier ones, so the pile reads as a
                  // pile and the card leaving is always the one on top.
                  zIndex: faces.length - i,
                  transformStyle: "preserve-3d",
                }}
                // Starts on the deck, flat and unlifted.
                initial={{
                  left: flight!.pileX - w / 2,
                  top: flight!.pileY - h / 2,
                  scale: 0.8,
                  opacity: 0,
                }}
                // The card that will become a hand element carries that
                // element's layoutId, so framer animates one card into the
                // strip rather than swapping two.
                layoutId={handoff && card ? `hand-${card.id}` : undefined}
                animate={
                  gone
                    ? {
                        left: midX + offset - w / 2,
                        top: endY - h / 2,
                        scale: 0.7,
                        opacity: 0,
                      }
                    : {
                        // Waiting its turn: stacked on the deck, peeled a
                        // little toward the mat's middle so the stack has
                        // depth rather than being one card thick.
                        left: flight!.pileX - w / 2 + liftUx * (h * 0.1 + i * 1.6),
                        top: flight!.pileY - h / 2 + liftUy * (h * 0.1 + i * 1.6),
                        scale: 1,
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
                transition={{
                  type: "spring",
                  stiffness: gone ? 200 : 320,
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
