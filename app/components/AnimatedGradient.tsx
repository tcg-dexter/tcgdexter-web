"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

interface Layer {
  id: number;
  gradient: string;
}

interface Props {
  /** CSS `background` value — solid color or gradient. */
  gradient: string;
  /** Must include a position value (`relative`/`absolute`/etc.) so the
   *  crossfading layers can fill it via `inset-0`. */
  className: string;
  style?: CSSProperties;
  children?: ReactNode;
}

const FADE_MS = 500;

/**
 * Crossfades `background` between successive `gradient` values instead
 * of snapping — used by the profile banner/avatar/Wins tile so picking a
 * new accent color dissolves into it rather than hard-cutting.
 *
 * Renders two stacked layers rather than transitioning `background`
 * directly: browsers only interpolate between two `linear-gradient()`
 * values reliably when their stop counts match, and they don't here —
 * the brand fallback has 3 stops, a single energy accent has 2. Opacity
 * is universally animatable regardless of what's underneath, so the
 * incoming gradient fades in over the outgoing one, which is dropped
 * once the fade completes.
 */
export default function AnimatedGradient({ gradient, className, style, children }: Props) {
  const [layers, setLayers] = useState<Layer[]>(() => [{ id: 0, gradient }]);
  const [topVisible, setTopVisible] = useState(true);
  const nextId = useRef(1);

  // New gradient → stack a fresh layer on top, starting invisible.
  useEffect(() => {
    setLayers((prev) => {
      const top = prev[prev.length - 1];
      if (top.gradient === gradient) return prev;
      return [...prev, { id: nextId.current++, gradient }];
    });
    setTopVisible(false);
  }, [gradient]);

  // Flip the new top layer visible on the next frame so the opacity
  // change is a transition, not an instant jump.
  useEffect(() => {
    if (topVisible) return;
    const raf = requestAnimationFrame(() => setTopVisible(true));
    return () => cancelAnimationFrame(raf);
  }, [layers, topVisible]);

  // Once the fade-in finishes, drop every layer below the new top one.
  useEffect(() => {
    if (!topVisible || layers.length <= 1) return;
    const timer = setTimeout(() => setLayers((prev) => prev.slice(-1)), FADE_MS + 50);
    return () => clearTimeout(timer);
  }, [topVisible, layers]);

  return (
    <div className={className} style={style}>
      {layers.map((l, i) => (
        <div
          key={l.id}
          aria-hidden="true"
          className="absolute inset-0 transition-opacity duration-500 ease-in-out"
          style={{ background: l.gradient, opacity: i === layers.length - 1 ? (topVisible ? 1 : 0) : 1 }}
        />
      ))}
      {children && <div className="relative">{children}</div>}
    </div>
  );
}
