"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from "framer-motion";
import { useBeat } from "../director/BeatContext";
import { type CardRole, type MatCards } from "./claim";
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
/* Claim delivery                                                   */
/* ──────────────────────────────────────────────────────────────── */

/**
 * A card's role reaches it through context rather than as a prop, and that is
 * load-bearing rather than a style choice.
 *
 * AnimatePresence renders an exiting child from the element it cached when
 * the child was removed, so that element's PROPS are frozen at their last
 * values. A knocked-out Pokémon is exactly that case: it leaves the board on
 * the very frame that knocks it out, so a `claim` passed down as a prop would
 * be whatever it was one beat earlier — never "target" — and the card would
 * play no recoil and emit no debris. Context is read at render time, so the
 * departing card sees the current beat like everything else.
 */
export interface CardClaim {
  role: CardRole | null;
  /** Damage this specific card is taking, when the beat hits several at once
   *  and each takes its own amount. Null falls back to the beat's own. */
  damage: number | null;
}

const UNCLAIMED: CardClaim = { role: null, damage: null };

export const ClaimContext = createContext<((id: string) => CardClaim) | null>(null);

export function useClaim(id: string | null): CardClaim {
  const resolve = useContext(ClaimContext);
  return resolve && id ? resolve(id) : UNCLAIMED;
}

/**
 * Remembers the previous DISTINCT board for a mat.
 *
 * Written during render rather than in an effect on purpose: an effect would
 * update the moment the knockout frame first painted, and every later render
 * of that frame — one per beat phase — would find the departing card already
 * forgotten, dropping its recoil part-way through its own exit. The write is
 * idempotent (re-rendering with the same cards changes nothing), which is
 * what makes it safe to do here.
 */
export function usePreviousMatCards(cards: MatCards): MatCards {
  const ref = useRef<{ current: MatCards; previous: MatCards }>({
    current: { active: null, bench: [] },
    previous: { active: null, bench: [] },
  });
  if (
    ref.current.current.active !== cards.active ||
    ref.current.current.bench !== cards.bench
  ) {
    ref.current = { current: cards, previous: ref.current.current };
  }
  return ref.current.previous;
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
 * What this card should be doing right now.
 *
 * Takes the role its mat has already assigned it (see resolveClaim) rather
 * than working it out from a name — the card cannot tell an attacker from an
 * identically named bench-sitter on its own, because it cannot see the rest
 * of the board.
 */
export function useCardPerformance(
  role: CardRole | null,
  damageOverride: number | null = null,
): CardPerformance {
  const { beat, phase, instant, reducedMotion } = useBeat();

  const resting: CardPerformance = {
    role: "bystander",
    pose: "rest",
    phase,
    beat,
    incomingDamage: null,
  };
  // A jump has no performance to give, and reduced motion has asked for none.
  if (!beat || !role || role === "bystander" || instant || reducedMotion) {
    return resting;
  }

  const climax = beat.weight === "climax";
  if (role === "actor") {
    return { ...resting, role: "actor", pose: poseFor("actor", phase, climax) };
  }
  return {
    ...resting,
    role: "target",
    pose: poseFor("target", phase, climax),
    incomingDamage:
      damageOverride ??
      (beat.kind === "attack" && beat.damage > 0
        ? beat.damage
        : beat.kind === "damage_counters" && beat.counters > 0
          ? beat.counters * 10
          : null),
  };
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
 *
 * Presented as a struck badge rather than a bare "−140". The minus sign was
 * doing the work of saying "this is damage", which a number sitting on its own
 * over a card needs a sign for; on a coloured plate it doesn't, and the plate
 * says it louder. It also matches the move name plate that named the attack a
 * beat earlier, so cause and effect are visibly the same kind of object.
 */
export function DamageBurst({
  amount,
  fontSize,
  radius,
  tint,
}: {
  amount: number;
  fontSize: number;
  radius: number;
  /** Overrides the attack colouring — between-turns Poison and Burn damage
   *  carries its own condition's colour so the badge agrees with the border
   *  being drawn around the card at the same moment. */
  tint?: { from: string; to: string; glow: string };
}) {
  const accent = tint ?? {
    from: "#b91c1c",
    to: "#f97316",
    glow: "rgba(249,115,22,0.65)",
  };
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
      <motion.div
        className="relative flex items-center justify-center"
        initial={{ y: -fontSize * 1.4, scale: 1.9, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 700, damping: 18, mass: 0.6 }}
      >
        <div
          className="absolute inset-y-0 -inset-x-2"
          style={{
            background: `linear-gradient(100deg, ${accent.from}, ${accent.to})`,
            transform: "skewX(-13deg)",
            boxShadow: `0 3px 14px ${accent.glow}`,
            borderRadius: 3,
          }}
        />
        <span
          className="relative select-none font-black tabular-nums leading-none text-white"
          style={{
            fontSize,
            padding: `${fontSize * 0.22}px ${fontSize * 0.42}px`,
            textShadow: "0 1px 3px rgba(0,0,0,0.5)",
          }}
        >
          {amount}
        </span>
      </motion.div>
    </motion.div>
  );
}

/* ──────────────────────────────────────────────────────────────── */
/* Condition border                                                 */
/* ──────────────────────────────────────────────────────────────── */

/** Perimeter of a rounded rectangle, clockwise from the top-left corner. */
function roundedRectPath(w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  return [
    `M ${rr} 0`,
    `H ${w - rr}`,
    `A ${rr} ${rr} 0 0 1 ${w} ${rr}`,
    `V ${h - rr}`,
    `A ${rr} ${rr} 0 0 1 ${w - rr} ${h}`,
    `H ${rr}`,
    `A ${rr} ${rr} 0 0 1 0 ${h - rr}`,
    `V ${rr}`,
    `A ${rr} ${rr} 0 0 1 ${rr} 0`,
    "Z",
  ].join(" ");
}

/**
 * Measure an element. Needed because the condition border is drawn as a real
 * path around the card holder, and the holder's height depends on what it
 * contains — a Tool peeking above the art, an HP bar that isn't there for a
 * Pokémon with no printed HP. Scaling one viewBox to fit would turn the
 * corner radii into ellipses.
 */
export function useElementSize<T extends HTMLElement>(): [
  React.RefObject<T>,
  { width: number; height: number },
] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((prev) =>
        // Guarded: the camera scales the board, and writing every
        // sub-pixel change back into state would re-render every card on
        // the mat for the whole of a push-in.
        Math.abs(prev.width - r.width) < 0.5 && Math.abs(prev.height - r.height) < 0.5
          ? prev
          : { width: r.width, height: r.height },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/**
 * A line drawn around the outside of the card as a Special Condition bites.
 *
 * Between-turns Poison and Burn damage had nothing of its own: it arrived as a
 * damage counter identical to an attack's, on a card nobody had just attacked,
 * with only the small corner pill to say why. Drawing the card's outline in
 * the condition's colour ties the damage to the badge already sitting on it.
 *
 * A stroked path rather than a CSS border so it can be drawn rather than
 * simply appear — the travelling line is what reads as the condition acting,
 * where a border switching on reads as a selection state.
 */
export function ConditionBorder({
  width,
  height,
  radius,
  color,
}: {
  width: number;
  height: number;
  radius: number;
  color: string;
}) {
  if (width <= 0 || height <= 0) return null;
  // Sits just outside the black holder, so it reads as a ring around the card
  // rather than a frame drawn on top of its contents.
  const pad = 3;
  const stroke = 2.5;
  const w = width + pad * 2;
  const h = height + pad * 2;
  return (
    <motion.svg
      className="pointer-events-none absolute"
      style={{ left: -pad, top: -pad, zIndex: 25, overflow: "visible" }}
      width={w}
      height={h}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.35 } }}
      aria-hidden
    >
      <motion.path
        d={roundedRectPath(w - stroke, h - stroke, radius + pad)}
        transform={`translate(${stroke / 2} ${stroke / 2})`}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 5px ${color})` }}
        // pathLength normalises the perimeter to 1, so one dash of length 1
        // covers the whole outline and the offset is simply "how much is yet
        // to be drawn" — no need to know the real perimeter in pixels.
        pathLength={1}
        strokeDasharray="1 1"
        initial={{ strokeDashoffset: 1 }}
        animate={{ strokeDashoffset: 0 }}
        transition={{ duration: 0.6, ease: "easeInOut" }}
      />
    </motion.svg>
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
