"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Beat } from "@/lib/replay2/beats";
import type { BeatPhase } from "./choreography";

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
}

const REST: BeatContextValue = {
  beat: null,
  phase: "settle",
  instant: false,
  reducedMotion: false,
};

const BeatContext = createContext<BeatContextValue>(REST);

export function BeatProvider({
  beat,
  phase,
  instant,
  reducedMotion,
  children,
}: BeatContextValue & { children: ReactNode }) {
  const value = useMemo(
    () => ({ beat, phase, instant, reducedMotion }),
    [beat, phase, instant, reducedMotion],
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
