"use client";

import { useEffect, useRef, useState } from "react";
import type { Beat } from "@/lib/replay2/beats";
import {
  choreographyFor,
  specDuration,
  type BeatPhase,
  type ChoreographySpec,
} from "./choreography";

/**
 * Replay 2.0's playback clock.
 *
 * Replaces v1's `setInterval(1000 / speed)` with a per-beat timeline: each
 * frame is held for as long as its beat has earned (see choreography.ts), and
 * while it's held the director ticks through that beat's phases so the board
 * can wind up, act, and settle over a single unchanging board state.
 *
 * Two properties are load-bearing and easy to lose in a refactor:
 *
 *  - **Phases run whether or not playback is running.** Stepping one action
 *    with the transport should perform the beat, not snap to its end state.
 *    Only the auto-advance is gated on `playing`.
 *  - **The frame is still the truth.** The director never touches board
 *    state; it only decides when the viewer moves to the next frame and what
 *    phase the current one is in. A jump can therefore discard the whole
 *    timeline and cut, which is exactly what `instant` does.
 */

export interface DirectorArgs {
  /** Beat for a given frame index, or null if that frame has none. */
  beatAt: (frameIndex: number) => Beat | null;
  /** True when this frame repeats the previous frame's actionIndex — a
   *  discard/draw stage or a mulligan row, not a fresh action. */
  isContinuation: (frameIndex: number) => boolean;
  frameIndex: number;
  frameCount: number;
  playing: boolean;
  speed: number;
  /** The playhead jumped rather than stepped; cut instead of performing. */
  instant: boolean;
  /** Advance the playhead. Called only while playing, and never past the end. */
  onAdvance: () => void;
}

export interface DirectorState {
  /** Phase of the beat currently on screen. Rests at "settle". */
  phase: BeatPhase;
  /** The beat currently on screen, for the board to choreograph against. */
  beat: Beat | null;
  /** Its full spec, so a component can match its own transition to the beat's
   *  timing instead of hard-coding a duration that drifts out of sync. */
  spec: ChoreographySpec;
}

export function useDirector({
  beatAt,
  isContinuation,
  frameIndex,
  frameCount,
  playing,
  speed,
  instant,
  onAdvance,
}: DirectorArgs): DirectorState {
  const [phase, setPhase] = useState<BeatPhase>("settle");

  // Read through refs inside the effect rather than listed as dependencies:
  // these change identity on most renders, and a re-run would restart the
  // beat's timeline from its first phase mid-performance.
  const beatAtRef = useRef(beatAt);
  beatAtRef.current = beatAt;
  const isContinuationRef = useRef(isContinuation);
  isContinuationRef.current = isContinuation;
  const onAdvanceRef = useRef(onAdvance);
  onAdvanceRef.current = onAdvance;

  const beat = beatAt(frameIndex);
  const spec = choreographyFor(beat, {
    instant,
    continuation: isContinuation(frameIndex),
  });

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const current = choreographyFor(beatAtRef.current(frameIndex), {
      instant,
      continuation: isContinuationRef.current(frameIndex),
    });
    // Guard against a speed of 0 or a negative arriving from anywhere; a
    // zero divisor here would schedule everything at Infinity and freeze
    // playback with no visible cause.
    const scale = 1 / Math.max(0.1, speed);

    setPhase(current.phases[0]?.phase ?? "settle");
    let elapsed = 0;
    for (let i = 1; i < current.phases.length; i++) {
      elapsed += current.phases[i - 1].ms * scale;
      const next = current.phases[i].phase;
      timers.push(setTimeout(() => setPhase(next), elapsed));
    }

    if (playing && frameIndex < frameCount - 1) {
      timers.push(
        setTimeout(() => onAdvanceRef.current(), specDuration(current) * scale),
      );
    }

    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [frameIndex, frameCount, playing, speed, instant]);

  return { phase, beat, spec };
}
