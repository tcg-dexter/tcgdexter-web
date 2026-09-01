"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { emitFocus, emitFx, onDrawFlight, type FxDrawFlight } from "./fxBus";
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
 * deck — it is put in a hand, and looked at there. It travels once and turns
 * over where it lands (see the hand strip, which holds a card's back until the
 * rest of its draw has arrived).
 *
 * Dealt one at a time, not as a block — which is how a hand is actually dealt,
 * and which turns the opening seven from a single shuffle-and-appear into
 * something with a rhythm to watch.
 *
 * THE MOVE, in three parts, because the deck and the hand hold a card in two
 * different orientations and the turn between them is the thing worth
 * watching:
 *
 *   waiting   The card is the deck. It is drawn as the deck's own sleeve, at
 *             the deck's own landscape rectangle, lying down exactly as the
 *             pile renders it — so it is invisible against the pile until it
 *             moves, and what leaves is unmistakably the top card.
 *   turning   Its turn comes: the card lifts off the pile and stands up,
 *             the box going landscape → portrait while the sleeve inside
 *             counter-rotates from the deck's angle to upright. One motion,
 *             not a fade between two pictures.
 *   handoff   Standing upright and clear of the deck, it stops rendering and
 *             the hand's OWN element — same layoutId, same portrait sleeve —
 *             picks the movement up and carries it into the strip, cropping
 *             to the hand's half-height on the way. One card moves; nothing
 *             is swapped in view.
 *
 * The rotation is deliberately finished BEFORE the handoff rather than during
 * it. A shared-layout transition animates a box by projecting it, and a
 * rotation riding on that projection skews; keeping the two legs separate
 * means each is doing the one thing it is good at.
 *
 * The opponent's cards have no hand on screen to become, so they take the
 * first two parts and then leave past the top of their own mat.
 *
 * The cadence comes from `staggerMs`, which the viewer derives from the beat's
 * own choreographed length and the playback speed, so the whole deal finishes
 * inside its beat at 0.5x and at 4x alike.
 */

/**
 * How long a card spends standing up, as a multiple of the gap between deals.
 *
 * Expressed against the stagger rather than in milliseconds so it inherits the
 * playback speed and the beat-length cap for free: whatever cadence the viewer
 * settles on, a card's turn is a beat and a half of it, and the cards in the
 * air overlap without the deal ever running past its own beat.
 */
const TURN_RATIO = 1.5;

interface FlightState extends FxDrawFlight {
  /** Stage-local geometry, converted once on arrival. The pile rect is the
   *  deck's card slot: landscape, so slotW is the card's long edge. */
  slotX: number;
  slotY: number;
  slotW: number;
  slotH: number;
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
  playerSleeveGradient,
  opponentSleeveGradient,
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
  /** Sleeve colour for cards leaving each side's deck — see CardSleeve. */
  playerSleeveGradient?: string | null;
  opponentSleeveGradient?: string | null;
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
  // How many have finished standing up and been handed to the hand. Trails
  // `release` by one card's turn.
  const [handedState, setHanded] = useState<{ action: number; count: number }>({
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
        slotX: (d.pileLeft - r.left) * sx,
        slotY: (d.pileTop - r.top) * sy,
        slotW: d.pileWidth * sx,
        slotH: d.pileHeight * sy,
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

  const sleeveGradient = ready
    ? flight!.actor === "player"
      ? playerSleeveGradient
      : opponentSleeveGradient
    : null;

  /**
   * The card, in both orientations, taken from the deck's own measured slot
   * rather than from cardWidth.
   *
   * The slot IS the card lying down: its long edge across, its short edge
   * down. So the upright card is that rectangle's two sides swapped, and the
   * two poses are guaranteed to be the same card at the same scale — which is
   * what lets the turn read as one object rotating instead of a box resizing.
   */
  const slotW = ready ? flight!.slotW : 0;
  const slotH = ready ? flight!.slotH : 0;
  const upW = slotH;
  const upH = slotW;
  const cx = ready ? flight!.slotX + slotW / 2 : 0;
  const cy = ready ? flight!.slotY + slotH / 2 : 0;
  // Matches RotatedCardFace: the deck's sleeve is a portrait card turned by
  // this much, so a card leaving it starts there and unwinds to upright.
  const deg = ready ? (flight!.pileRotate === "cw" ? 90 : -90) : 0;

  const midX = ready ? flight!.matX + flight!.matW / 2 : 0;
  const midY = ready ? flight!.matY + flight!.matH / 2 : 0;
  /**
   * Which way a card comes off the deck: toward the middle of its own mat.
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
  const liftLen = ready ? Math.hypot(midX - cx, midY - cy) || 1 : 1;
  const liftUx = ready ? (midX - cx) / liftLen : 0;
  const liftUy = ready ? (midY - cy) / liftLen : 0;
  // Far enough off the pile that the card is clear of it before the hand
  // takes over, and no further: this is a card being lifted out of a deck,
  // not thrown across the mat.
  const lift = upH * 0.42;
  // The player's hand sits under the board; the opponent's is off screen
  // entirely, so their cards leave past the top of their own mat.
  const endY = !ready
    ? 0
    : flight!.actor === "player"
      ? flight!.matY + flight!.matH + upH * 0.9
      : flight!.matY - upH * 1.1;
  const fan = ready
    ? Math.min(upW * 0.72, (flight!.matW * 0.8) / Math.max(1, faces.length))
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
  const handed = ready && handedState.action === flightActionIndex ? handedState.count : 0;

  /**
   * The deal itself.
   *
   * Two clocks rather than one, offset by the length of a card's turn: a card
   * starts standing up at `i * stagger`, and hands off to the hand once it is
   * upright. Driving the handoff from a clock rather than from the turn's own
   * onAnimationComplete keeps it deterministic — an interrupted or dropped
   * completion callback would strand a card mid-air with the hand still
   * holding its place open for it.
   */
  useEffect(() => {
    if (!active || flightActionIndex == null || total === 0) return;
    setRelease({ action: flightActionIndex, count: 0 });
    setHanded({ action: flightActionIndex, count: 0 });
    // Floored so a pathological speed or a very short beat can't turn this
    // into a busy loop; the deal simply becomes near-simultaneous.
    const step = Math.max(35, staggerMs);
    let n = 0;
    // The pile's own coordinates in host space, so bursts here fire whether
    // or not the mat is measurable at emit time.
    const pileCX = flight!.slotX + flight!.slotW / 2;
    const pileCY = flight!.slotY + flight!.slotH / 2;
    // client rect of the host, resolved once per deal — the pileCX / pileCY
    // above are in host coordinates and have to translate back to client
    // pixels for the fxBus, which operates in the viewport's own space.
    const hostBounds = hostRef.current?.getBoundingClientRect() ?? null;
    const isOpening = beat?.kind === "opening_hand";
    const toClientX = (hx: number) =>
      hostBounds ? hostBounds.left + hx : hx;
    const toClientY = (hy: number) =>
      hostBounds ? hostBounds.top + hy : hy;
    const dealing = setInterval(() => {
      n += 1;
      setRelease({ action: flightActionIndex, count: n });
      // A little spark on the deck the moment a card leaves it — small,
      // frequent, sleeve-warm. Only for the opening hand: the ordinary turn
      // draw is a bookkeeping beat that shouldn't be decorated on every use.
      if (isOpening) {
        emitFx({
          kind: "spark",
          clientX: toClientX(pileCX),
          clientY: toClientY(pileCY),
          intensity: 0.55,
          color: "#fde68a",
        });
      }
      if (n >= total) clearInterval(dealing);
    }, step);
    let m = 0;
    let handing: ReturnType<typeof setInterval> | null = null;
    const first = setTimeout(() => {
      const tick = () => {
        m += 1;
        setHanded({ action: flightActionIndex, count: m });
        // The hand un-hides a card when it ARRIVES, not when it leaves the
        // deck — for the stretch in between, the only copy of it on screen is
        // the one in the air.
        onLandedRef.current?.(flightActionIndex, m);
        // Each landing gets a small burst where the card stopped, and the
        // last one lights the hand up: a bigger spark plus a focus request
        // so the camera pushes in on the seven waiting to be revealed.
        if (isOpening) {
          const isLast = m >= total;
          emitFx({
            kind: "spark",
            clientX: toClientX(midX),
            clientY: toClientY(endY - upH * 0.4),
            intensity: isLast ? 1.6 : 0.7,
            color: "#fde68a",
          });
          if (isLast) {
            emitFocus({
              clientX: toClientX(midX),
              clientY: toClientY(endY - upH * 0.2),
              actionIndex: flightActionIndex,
              climax: true,
            });
          }
        }
        if (m >= total && handing) clearInterval(handing);
      };
      tick();
      if (total > 1) handing = setInterval(tick, step);
    }, step * TURN_RATIO);
    return () => {
      clearInterval(dealing);
      clearTimeout(first);
      if (handing) clearInterval(handing);
    };
  }, [active, flightActionIndex, total, staggerMs]);

  return (
    <div ref={hostRef} className="pointer-events-none absolute inset-0 z-[35]">
      <AnimatePresence>
        {ready &&
          active &&
          faces.map((card, i) => {
            const turning = i < released;
            const arrived = i < handed;
            // An arrived card with a hand element waiting for it stops
            // rendering here entirely — the strip's element shares its
            // layoutId and picks the movement up from exactly this pose, so
            // one card travels and nothing is swapped in view. One with
            // nowhere to go (the opponent's) leaves frame instead.
            if (arrived && handoff) return null;
            const offset = (i - (faces.length - 1) / 2) * fan;
            // Upright and clear of the deck. Also where the hand's element
            // takes over, which is why it is a pose and not a waypoint.
            const stood = {
              left: cx - upW / 2 + liftUx * lift,
              top: cy - upH / 2 + liftUy * lift,
              width: upW,
              height: upH,
            };
            return (
              <motion.div
                key={`${flight!.actionIndex}-${i}`}
                className="absolute"
                style={{
                  // Later cards sit under earlier ones, so the deck reads as a
                  // stack and what leaves is always the card on top.
                  zIndex: faces.length - i,
                }}
                // Starts AS the deck: the pile's own card slot, to the pixel.
                // Against the sleeve already drawn there it is invisible until
                // it moves, which is what makes the card look like it came off
                // the top rather than appearing next to it.
                initial={{
                  left: flight!.slotX,
                  top: flight!.slotY,
                  width: slotW,
                  height: slotH,
                }}
                // The card that will become a hand element carries that
                // element's layoutId, so framer animates one card into the
                // strip rather than swapping two.
                layoutId={handoff && card ? `hand-${card.id}` : undefined}
                animate={
                  arrived
                    ? {
                        // Only the opponent's get here: no hand to join, so
                        // they carry on past the edge of their own mat.
                        ...stood,
                        left: midX + offset - upW / 2,
                        top: endY - upH / 2,
                        opacity: 0,
                      }
                    : turning
                      ? stood
                      : {
                          left: flight!.slotX,
                          top: flight!.slotY,
                          width: slotW,
                          height: slotH,
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
                  stiffness: arrived ? 200 : 300,
                  damping: arrived ? 30 : 26,
                  mass: 0.8,
                  // The move into the hand is the shared-layout leg, and it
                  // is the one the eye follows — given its own spring so the
                  // card settles into the strip rather than snapping.
                  layout: { type: "spring", stiffness: 260, damping: 32, mass: 0.9 },
                }}
              >
                {/* The card itself, always upright-sized and turned to suit —
                    it is the SAME rectangle in both poses, just rotated, which
                    is what makes the move read as one object standing up
                    rather than a box changing shape. Its bounding box at the
                    deck's angle is exactly the landscape slot above, so the
                    two agree to the pixel at rest and are free to disagree
                    mid-turn, where the overflow is the point.
                    
                    CardSleeve is the single definition of the deck's back,
                    shared with the pile and the prize stack, so a card in the
                    air is wearing literally what it was wearing in the deck. */}
                <motion.div
                  className="absolute overflow-hidden rounded shadow-[0_10px_26px_rgba(0,0,0,0.4)]"
                  style={{ left: "50%", top: "50%", width: upW, height: upH }}
                  initial={{ x: "-50%", y: "-50%", rotate: deg }}
                  animate={{ x: "-50%", y: "-50%", rotate: turning ? 0 : deg }}
                  transition={{ type: "spring", stiffness: 240, damping: 24, mass: 0.7 }}
                >
                  <CardSleeve radius={6} gradient={sleeveGradient} />
                </motion.div>
              </motion.div>
            );
          })}
      </AnimatePresence>
    </div>
  );
}
