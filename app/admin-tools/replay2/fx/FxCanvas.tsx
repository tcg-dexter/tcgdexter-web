"use client";

import { useEffect, useRef } from "react";
import { ParticleSystem } from "./particles";
import { onFx } from "./fxBus";

/**
 * The board's effects overlay.
 *
 * One canvas for the whole board, absolutely positioned over the mats and
 * fully transparent to input. Everything it draws is decorative: pull it out
 * and the replay still plays correctly, which is the property that lets it be
 * this aggressive visually.
 *
 * It must live INSIDE the camera's transform. A burst is emitted at a card's
 * position, so if the camera pushes in on that card and the canvas doesn't
 * come along, the effect stays behind on the mat while the card it belongs to
 * moves away. Being inside also makes the coordinate conversion self-correcting
 * — see `toLocal`.
 */
export function FxCanvas({ reducedMotion }: { reducedMotion: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const systemRef = useRef<ParticleSystem | null>(null);
  if (systemRef.current == null) systemRef.current = new ParticleSystem();

  useEffect(() => {
    if (reducedMotion) return;
    const canvas = canvasRef.current;
    const system = systemRef.current;
    if (!canvas || !system) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    // Backing store in device pixels, drawing coordinates in CSS pixels.
    // Capped at 2x: a 3x phone gains nothing visible from nine times the fill
    // rate, and this is the one surface where the cost lands every frame.
    function resize() {
      const parent = canvas!.parentElement;
      if (!parent) return;
      const r = parent.getBoundingClientRect();
      // The parent may itself be scaled by the camera; divide it back out so
      // the canvas is sized in layout pixels rather than growing every time
      // the camera pushes in.
      const scale = parent.offsetWidth > 0 ? r.width / parent.offsetWidth : 1;
      width = r.width / (scale || 1);
      height = r.height / (scale || 1);
      canvas!.width = Math.max(1, Math.round(width * dpr));
      canvas!.height = Math.max(1, Math.round(height * dpr));
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    /**
     * Client coordinates → canvas coordinates.
     *
     * Divides by the canvas's own on-screen scale rather than reading the
     * camera's state, so it stays correct through any transform an ancestor
     * applies — camera push-in, shake, a future zoom — without this layer
     * knowing any of them exist.
     */
    function toLocal(clientX: number, clientY: number) {
      const r = canvas!.getBoundingClientRect();
      const sx = r.width > 0 ? width / r.width : 1;
      const sy = r.height > 0 ? height / r.height : 1;
      return { x: (clientX - r.left) * sx, y: (clientY - r.top) * sy };
    }

    const off = onFx((e) => {
      const { x, y } = toLocal(e.clientX, e.clientY);
      // Particle sizes and speeds are tuned against a full-size desktop
      // board; on a small mat everything has to shrink with it or a single
      // impact covers the whole mat.
      const scale = Math.max(0.45, Math.min(1.4, width / 620));
      system.emit(e.kind, x, y, e.intensity ?? 1, e.color ?? "#ff5a4d", scale);
    });

    let raf = 0;
    let last = performance.now();
    // Idles when nothing is alive rather than clearing a blank canvas sixty
    // times a second for the whole of a quiet replay.
    let idleFrames = 0;

    function loop(now: number) {
      const elapsed = now - last;
      last = now;
      // In 60fps frames, and clamped: a backgrounded tab resumes with a
      // multi-second delta, which would teleport every live particle off
      // screen in a single step.
      const dt = Math.min(3, elapsed / (1000 / 60));

      ctx!.clearRect(0, 0, width, height);
      system!.step(ctx!, dt);

      idleFrames = system!.busy ? 0 : idleFrames + 1;
      // A short grace period so a burst arriving one frame after the last one
      // died doesn't have to pay to restart the loop.
      if (idleFrames > 30) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(loop);
    }

    // Kicked by every emit, so the loop exists only while there's something
    // to draw.
    const offKick = onFx(() => {
      if (raf === 0) {
        last = performance.now();
        idleFrames = 0;
        raf = requestAnimationFrame(loop);
      }
    });

    return () => {
      off();
      offKick();
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      system.clear();
    };
  }, [reducedMotion]);

  if (reducedMotion) return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-30"
    />
  );
}
