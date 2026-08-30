"use client";

import { useEffect, useRef, useState } from "react";
import { onFocus } from "./fxBus";
import type { BeatPhase } from "../director/choreography";

/**
 * The board camera.
 *
 * Leans the whole board toward whatever the current beat is about, then
 * settles back. It's the cheapest cinematic tool available and the one that
 * does most for comprehension: on a board with twelve Pokémon on it, a push-in
 * answers "where do I look?" before the viewer has to work it out from the
 * thread.
 *
 * Kept deliberately restrained. The board is a fixed 16:9 window that the
 * viewer is also reading a synced thread beside, so a camera that swings hard
 * costs more in legibility than it earns in drama — hence the small maximum
 * scale and the clamped offsets below.
 */

export interface CameraState {
  x: number;
  y: number;
  scale: number;
  /** Set for the frames a climax beat is landing on; the board jolts. */
  shake: boolean;
}

const REST: CameraState = { x: 0, y: 0, scale: 1, shake: false };

/** Hard ceilings. A push past ~1.1 starts pulling mats out of the 16:9
 *  window, and a lean past ~5% of the board pushes the far mat's prize
 *  column off the edge. */
const MAX_SCALE_CLIMAX = 1.09;
const MAX_SCALE_NORMAL = 1.035;
const MAX_OFFSET_RATIO = 0.05;

export function useCamera({
  containerRef,
  phase,
  actionIndex,
  reducedMotion,
  enabled,
}: {
  containerRef: React.RefObject<HTMLElement>;
  phase: BeatPhase;
  /** Current beat's action index, or null when there's no beat. */
  actionIndex: number | null;
  reducedMotion: boolean;
  /** Off while an inspector is open — the board is being read, not watched. */
  enabled: boolean;
}): CameraState {
  const [camera, setCamera] = useState<CameraState>(REST);
  // The action a focus has already been accepted for. Focusing MOVES the
  // board, which moves the card, which would emit a new focus from its new
  // position — a feedback loop that walks the camera off the mat. One sample
  // per action, taken while the camera is still at rest, breaks it.
  const sampledFor = useRef<number | null>(null);
  const climaxRef = useRef(false);

  useEffect(() => {
    if (reducedMotion || !enabled) {
      setCamera(REST);
      return;
    }
    return onFocus((f) => {
      if (sampledFor.current === f.actionIndex) return;
      const el = containerRef.current;
      if (!el) return;
      sampledFor.current = f.actionIndex;
      climaxRef.current = f.climax;

      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      // How far the subject sits from the board's centre, as a fraction of
      // the board. Negated because the board moves opposite to the subject:
      // to bring something on the right into view, the board slides left.
      const dx = (f.clientX - (r.left + r.width / 2)) / r.width;
      const dy = (f.clientY - (r.top + r.height / 2)) / r.height;
      const limit = MAX_OFFSET_RATIO;
      const clamp = (v: number) => Math.max(-limit, Math.min(limit, v));
      const scale = f.climax ? MAX_SCALE_CLIMAX : MAX_SCALE_NORMAL;
      setCamera({
        x: -clamp(dx) * r.width,
        y: -clamp(dy) * r.height,
        scale,
        shake: false,
      });
    });
  }, [containerRef, reducedMotion, enabled]);

  // A climax beat's shake belongs to its impact phase specifically — the
  // moment the blow lands, not the wind-up before it or the settle after.
  useEffect(() => {
    if (reducedMotion || !enabled) return;
    setCamera((c) => {
      const shake = phase === "impact" && climaxRef.current;
      return c.shake === shake ? c : { ...c, shake };
    });
  }, [phase, reducedMotion, enabled]);

  // Return to rest between beats, and re-arm for the next one.
  useEffect(() => {
    if (actionIndex == null) return;
    if (sampledFor.current !== actionIndex) {
      // A new beat that nothing has asked to focus — an ability with no
      // resolvable source, a shuffle, a turn boundary. The camera should let
      // go rather than hold the last subject.
      setCamera(REST);
      climaxRef.current = false;
    }
  }, [actionIndex]);

  return reducedMotion || !enabled ? REST : camera;
}
