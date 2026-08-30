"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from "framer-motion";
import { useBeat, useMatActor } from "../director/BeatContext";
import type { Beat } from "@/lib/replay2/beats";
import type { BeatPhase } from "../director/choreography";

/**
 * Card material for Replay 2.0 — the layer that makes a card feel like an
 * object on a table rather than an image in a div.
 *
 * Deliberately CSS 3D, not WebGL. The board is a responsive DOM layout with
 * hit targets, inspectors and a thread-height coupling, and the assets are
 * flat card scans; a 3D scene of textured quads would mean rebuilding all of
 * that to render the same rectangles. `perspective` + `rotateX/rotateY` +
 * `translateZ` give real depth, composite on the GPU, and leave every card a
 * normal DOM node that can still be tapped and inspected.
 */

export type CardRole = "actor" | "target" | "bystander";

export type CardPose =
  /** Flat on the table. */
  | "rest"
  /** Picked up — this card is involved but not the one striking. */
  | "lift"
  /** Drawn back. The pause before a blow does more work than the blow. */
  | "windup"
  /** The blow. */
  | "strike"
  /** Taking it. */
  | "recoil";

interface PoseSpec {
  z: number;
  rotateX: number;
  scale: number;
  /** Shadow spread, scaled with apparent height off the table. */
  shadow: number;
}

const POSES: Record<CardPose, PoseSpec> = {
  rest: { z: 0, rotateX: 0, scale: 1, shadow: 0 },
  lift: { z: 22, rotateX: -5, scale: 1.035, shadow: 10 },
  windup: { z: 34, rotateX: -9, scale: 1.06, shadow: 16 },
  strike: { z: 46, rotateX: -14, scale: 1.1, shadow: 22 },
  recoil: { z: -8, rotateX: 7, scale: 0.965, shadow: 2 },
};

/* ──────────────────────────────────────────────────────────────── */
/* Beat → role                                                      */
/* ──────────────────────────────────────────────────────────────── */

/**
 * Who a beat is about: the Pokémon doing the thing, and the one it happens
 * to. Both are names, because that is all the log gives — the engine's
 * instance ids don't survive into the event stream (see beats.ts on the
 * knock_out case in particular).
 *
 * `side` is the actor's own mat unless stated otherwise. An attack is the one
 * beat that reaches across the board.
 */
function subjectsOf(beat: Beat): {
  actorName: string | null;
  targetName: string | null;
  targetOnOpposingMat: boolean;
} {
  const none = { actorName: null, targetName: null, targetOnOpposingMat: false };
  switch (beat.kind) {
    case "attack":
      return {
        actorName: beat.attacker || null,
        targetName: beat.defender || null,
        targetOnOpposingMat: true,
      };
    case "ability":
      return { ...none, actorName: beat.source || null };
    case "evolve":
      // The post-evolution name: by the time this frame renders, the card on
      // the board is already the new stage.
      return { ...none, actorName: beat.to || null };
    case "switch_active":
      return { ...none, actorName: beat.promoted || null };
    case "play_to_slot":
      return { ...none, actorName: beat.card || null };
    case "attach_energy":
      return { ...none, targetName: beat.target || null };
    case "knock_out":
      return { ...none, targetName: beat.pokemon || null };
    case "condition":
      return { ...none, targetName: beat.pokemon || null };
    case "damage_counters":
      return { ...none, targetName: beat.pokemon || null };
    case "discard_from_pokemon":
      return { ...none, targetName: beat.from || null };
    default:
      return none;
  }
}

/** Pose for a role at a phase. Climax beats get the striking poses; anything
 *  else is picked up and put back down. */
function poseFor(role: CardRole, phase: BeatPhase, climax: boolean): CardPose {
  if (role === "bystander") return "rest";
  if (role === "target") {
    return phase === "impact" ? "recoil" : phase === "act" ? "lift" : "rest";
  }
  switch (phase) {
    case "anticipate":
      return climax ? "windup" : "lift";
    case "act":
      return climax ? "strike" : "lift";
    case "impact":
      return climax ? "strike" : "lift";
    default:
      return "rest";
  }
}

/**
 * Which of a beat's two subjects the camera should look at.
 *
 * The target when there is one: an attack's story is where the damage lands,
 * not where it was thrown from, and an energy attachment or a condition has
 * no actor card at all. Falls back to the actor for the beats that are purely
 * someone doing something — an ability firing, a Pokémon being promoted.
 */
export function focusRole(beat: Beat): CardRole {
  return subjectsOf(beat).targetName ? "target" : "actor";
}

export interface CardPerformance {
  role: CardRole;
  pose: CardPose;
  phase: BeatPhase;
  beat: Beat | null;
  /** Damage this card is taking on this beat, if any — for the counter that
   *  lands on it during impact. */
  incomingDamage: number | null;
}

/**
 * Resolve what a named Pokémon should be doing right now.
 *
 * Matching is by name within a mat, which is the best the log supports. It
 * can over-match: two Noctowl on one bench both answer to "Noctowl", so both
 * will lift together for a beat that named one of them. That is a deliberate
 * trade — the alternative is no performance at all on a board where duplicate
 * names are ordinary, and two cards leaning in together reads as emphasis
 * rather than as a bug.
 */
export function useCardPerformance(monName: string | null): CardPerformance {
  const { beat, phase, instant, reducedMotion } = useBeat();
  const matActor = useMatActor();

  const resting: CardPerformance = {
    role: "bystander",
    pose: "rest",
    phase,
    beat,
    incomingDamage: null,
  };
  // A jump has no performance to give, and reduced motion has asked for none.
  if (!beat || !monName || instant || reducedMotion) return resting;
  // Without a mat identity there's no way to tell the attacker from an
  // identically named Pokémon on the other side of the board.
  if (!matActor) return resting;

  const { actorName, targetName, targetOnOpposingMat } = subjectsOf(beat);
  const onActorMat = matActor === beat.actor;
  const targetMat = targetOnOpposingMat ? beat.actor !== matActor : onActorMat;

  if (onActorMat && actorName && actorName === monName) {
    const climax = beat.weight === "climax";
    return { ...resting, role: "actor", pose: poseFor("actor", phase, climax) };
  }
  if (targetMat && targetName && targetName === monName) {
    return {
      ...resting,
      role: "target",
      pose: poseFor("target", phase, beat.weight === "climax"),
      incomingDamage:
        beat.kind === "attack" && beat.damage > 0
          ? beat.damage
          : beat.kind === "damage_counters" && beat.counters > 0
            ? beat.counters * 10
            : null,
    };
  }
  return resting;
}

/* ──────────────────────────────────────────────────────────────── */
/* Surface                                                          */
/* ──────────────────────────────────────────────────────────────── */

/**
 * Wraps a card in a perspective shell and animates it into its pose.
 *
 * Two nested transforms on purpose: the outer one is the pose (driven by the
 * beat), the inner one is the pointer tilt (driven by the mouse). Collapsing
 * them into one element means the two fight over `rotateX` and whichever
 * writes last wins, which shows up as a card that snaps flat the moment you
 * move the mouse over it mid-beat.
 */
export function CardSurface({
  pose,
  width,
  radius,
  tilt = true,
  idle = false,
  children,
}: {
  pose: CardPose;
  width: number;
  radius: number;
  /** Pointer-tracking tilt. Off for cards inside an inspector, where the
   *  card is already the whole subject and a tilt just wobbles it. */
  tilt?: boolean;
  /** Breathe slowly while at rest. Reserved for the Active Pokémon: a board
   *  where nothing moves between beats looks paused rather than waiting, but
   *  a whole bench breathing in unison looks like a screensaver. */
  idle?: boolean;
  children: ReactNode;
}) {
  const spec = POSES[pose];
  const ref = useRef<HTMLDivElement>(null);
  // One place decides whether the board performs at all.
  const { reducedMotion } = useBeat();
  const tilting = tilt && !reducedMotion;
  const breathing = idle && !reducedMotion && pose === "rest";

  // Raw pointer position as -0.5…0.5 of the card, sprung so the card has
  // some mass instead of tracking the cursor exactly.
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 260, damping: 26, mass: 0.4 });
  const sy = useSpring(py, { stiffness: 260, damping: 26, mass: 0.4 });
  const tiltY = useTransform(sx, [-0.5, 0.5], [-11, 11]);
  const tiltX = useTransform(sy, [-0.5, 0.5], [8, -8]);

  return (
    <div
      ref={ref}
      // Perspective scaled to the card so the 3D reads the same whether the
      // board is rendering at 60px or 200px wide. A fixed px value makes
      // small cards look violently angled and large ones look flat.
      style={{ perspective: width * 4.5, transformStyle: "preserve-3d" }}
      onPointerMove={
        tilting
          ? (e) => {
              const el = ref.current;
              if (!el) return;
              const r = el.getBoundingClientRect();
              px.set((e.clientX - r.left) / r.width - 0.5);
              py.set((e.clientY - r.top) / r.height - 0.5);
            }
          : undefined
      }
      onPointerLeave={
        tilting
          ? () => {
              px.set(0);
              py.set(0);
            }
          : undefined
      }
    >
      <motion.div
        style={{ transformStyle: "preserve-3d", borderRadius: radius }}
        animate={
          breathing
            ? {
                z: [0, 7, 0],
                rotateX: [0, -1.6, 0],
                scale: 1,
                x: 0,
                boxShadow: "0 3px 8px rgba(0,0,0,0.16)",
              }
            : {
                z: spec.z,
                rotateX: spec.rotateX,
                scale: spec.scale,
                // A card lifted off the table throws a longer, softer shadow.
                // The shadow is what actually sells the height — the rotation
                // alone reads as a wobble.
                boxShadow:
                  spec.shadow > 0
                    ? `0 ${spec.shadow}px ${spec.shadow * 1.6}px rgba(0,0,0,${
                        0.18 + spec.shadow * 0.008
                      })`
                    : "0 0px 0px rgba(0,0,0,0)",
                // Struck cards jolt sideways. Keyframes rather than a spring
                // so the hit has a hard leading edge instead of easing into
                // itself.
                x: pose === "recoil" ? [0, -7, 6, -4, 2, 0] : 0,
              }
        }
        transition={
          breathing
            ? { duration: 5.4, repeat: Infinity, ease: "easeInOut" }
            : {
                type: "spring",
                stiffness: 420,
                damping: 30,
                mass: 0.7,
                x: { duration: 0.34, ease: "easeOut" },
              }
        }
      >
        <motion.div
          style={
            tilting
              ? { rotateX: tiltX, rotateY: tiltY, transformStyle: "preserve-3d" }
              : { transformStyle: "preserve-3d" }
          }
        >
          {children}
        </motion.div>
      </motion.div>
    </div>
  );
}

/**
 * A band of light sweeping across the card face — the way a foil catches the
 * overhead light when someone tilts it toward you.
 *
 * `overlay` blend rather than a white scrim: it brightens the art's own
 * colours instead of washing them grey, so a dark card still reads as dark.
 */
export function FoilSheen({ active, radius }: { active: boolean; radius: number }) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          className="pointer-events-none absolute inset-0 z-20"
          style={{ borderRadius: radius, overflow: "hidden", mixBlendMode: "overlay" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <motion.div
            className="absolute inset-y-0"
            style={{
              width: "60%",
              background:
                "linear-gradient(105deg, transparent 0%, rgba(255,255,255,0.15) 35%, rgba(255,255,255,0.75) 50%, rgba(255,255,255,0.15) 65%, transparent 100%)",
            }}
            initial={{ left: "-70%" }}
            animate={{ left: "110%" }}
            transition={{ duration: 0.62, ease: "easeInOut" }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * The damage number landing on a struck card.
 *
 * Modelled on the physical act: in paper play damage arrives as counters
 * someone drops onto the card, and they land with weight. So this drops from
 * above, overshoots, and settles — rather than fading in, which reads as a
 * notification rather than an object.
 */
export function DamageBurst({
  amount,
  fontSize,
  radius,
}: {
  amount: number;
  fontSize: number;
  radius: number;
}) {
  return (
    <motion.div
      className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center"
      style={{ borderRadius: radius }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.24 } }}
    >
      {/* The hit itself: a brief white bloom over the whole card, gone before
          it registers as a colour change. */}
      <motion.div
        className="absolute inset-0 bg-white"
        style={{ borderRadius: radius }}
        initial={{ opacity: 0.85 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      />
      <motion.span
        className="relative select-none font-black tabular-nums text-white"
        style={{
          fontSize,
          textShadow:
            "0 2px 6px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.9), 0 0 18px rgba(239,68,68,0.9)",
        }}
        initial={{ y: -fontSize * 1.4, scale: 1.9, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 700, damping: 18, mass: 0.6 }}
      >
        −{amount}
      </motion.span>
    </motion.div>
  );
}

/* ──────────────────────────────────────────────────────────────── */
/* Travel                                                           */
/* ──────────────────────────────────────────────────────────────── */

/**
 * Lifts a card off the table for the duration of a layout animation.
 *
 * A promotion — bench Pokémon sliding into the Active slot — is a shared-layout
 * flight between two positions. v1 tweened it flat along a straight line at a
 * constant 300ms, which reads as a sprite sliding across a background: nobody
 * moves a card that way. In paper play you pick it up, move it, and set it
 * down, and the tell is the shadow.
 *
 * framer-motion won't animate along a curve, but it does report when a layout
 * animation starts and finishes — so the card can rise as it departs and
 * settle as it lands. The vertical displacement does the arcing; the shadow
 * does the convincing.
 */
export function useTravelLift(): {
  traveling: boolean;
  handlers: {
    onLayoutAnimationStart: () => void;
    onLayoutAnimationComplete: () => void;
  };
} {
  const [traveling, setTraveling] = useState(false);
  return {
    traveling,
    handlers: {
      onLayoutAnimationStart: () => setTraveling(true),
      onLayoutAnimationComplete: () => setTraveling(false),
    },
  };
}

/** Transform + shadow for a card mid-flight. Applied to the element that
 *  carries the layoutId, so it composes with the layout animation rather
 *  than competing with it. */
export function travelStyle(traveling: boolean) {
  return {
    z: traveling ? 60 : 0,
    boxShadow: traveling
      ? "0 26px 40px rgba(0,0,0,0.34)"
      : "0 0px 0px rgba(0,0,0,0)",
  };
}
