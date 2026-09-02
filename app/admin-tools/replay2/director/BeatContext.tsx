"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Beat } from "@/lib/replay2/beats";
import type { BeatPhase } from "./choreography";
import { MAT_ASPECT } from "@/lib/playmat-layout";

/**
 * The beat currently being performed, available to any card on the board.
 *
 * Board rendering runs through BoardKit's shared components — PlayerMat, then
 * a PokemonCardImage per Pokémon — and the interesting question for every one
 * of them is the same: "is this beat about ME?" Threading beat, phase and the
 * mat's actor identity down as props would mean touching every signature in
 * the kit and passing them through components that don't care, so this is a
 * context instead. Cards opt in by asking; nothing else changes.
 *
 * `reducedMotion` rides along here rather than being read per-component, so
 * there is exactly one place that decides whether the board performs at all.
 */

export interface BeatContextValue {
  beat: Beat | null;
  phase: BeatPhase;
  /** The viewer jumped rather than stepped — cut, don't perform. */
  instant: boolean;
  /** The viewer honours prefers-reduced-motion; every card should rest. */
  reducedMotion: boolean;
  /**
   * The frame belongs to game setup — before the first turn_start, while
   * Pokémon are being placed face-down and haven't been revealed yet.
   *
   * `state.turn.number` starts at 0 and only advances on turn_start (see
   * lib/engine/initial.ts), so the frame's own turn number is what setup
   * placements are told apart from an ordinary bench drop by: same
   * `play_to_slot` beat, different phase of the game around it.
   */
  duringSetup: boolean;
  /**
   * Height-over-width ratio for a single mat. Contextual so the widescreen
   * layout (collapsed thread → wider, shorter mats) can override it without
   * every consumer solving its own aspect. `lib/playmat-layout` supplies the
   * standard value; the collapsed-thread layout in ReplayViewer2 passes a
   * flatter one.
   */
  matAspect: number;
}

const REST: BeatContextValue = {
  beat: null,
  phase: "settle",
  instant: false,
  reducedMotion: false,
  duringSetup: false,
  matAspect: MAT_ASPECT,
};

const BeatContext = createContext<BeatContextValue>(REST);

export function BeatProvider({
  beat,
  phase,
  instant,
  reducedMotion,
  duringSetup,
  matAspect,
  children,
}: BeatContextValue & { children: ReactNode }) {
  const value = useMemo(
    () => ({ beat, phase, instant, reducedMotion, duringSetup, matAspect }),
    [beat, phase, instant, reducedMotion, duringSetup, matAspect],
  );
  return <BeatContext.Provider value={value}>{children}</BeatContext.Provider>;
}

export function useBeat(): BeatContextValue {
  return useContext(BeatContext);
}

/**
 * Which side's mat a subtree belongs to.
 *
 * Not the same thing as PlayerMat's `side` prop, which names the visual slot
 * (top mat is always laid out "player"-style with its tray on its own floor)
 * and is deliberately pinned regardless of whose data it shows — see the
 * comment on the Board's mat wrappers. Beat matching needs the *actor*, so it
 * gets its own context rather than reusing a prop that means something else.
 */
export const MatActorContext = createContext<"player" | "opponent" | null>(null);

export function useMatActor(): "player" | "opponent" | null {
  return useContext(MatActorContext);
}

/**
 * The on-screen bounds of the mat a subtree belongs to.
 *
 * A getter rather than a value: mat geometry is only ever needed at the
 * instant something is emitted, and publishing a rect through context would
 * mean re-rendering every card on the mat whenever the camera moved it.
 */
export const MatBoundsContext = createContext<(() => DOMRect | null) | null>(null);

export function useMatBounds(): (() => DOMRect | null) | null {
  return useContext(MatBoundsContext);
}

/**
 * The CSS gradient of the mat a subtree belongs to.
 *
 * Every face-down surface — the draw pile, the prize stack, a card mid-flight,
 * a setup placement still showing its back — is the same object: this side's
 * deck. They should all read as cut from the one sleeve, so there is one
 * source for the colour rather than each place that draws a back deciding
 * for itself.
 */
export const MatGradientContext = createContext<string | null>(null);

export function useMatGradient(): string | null {
  return useContext(MatGradientContext);
}
