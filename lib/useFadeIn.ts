"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

const STAGGER_MS = 15;

/**
 * Fade-in + slide-down entrance matching CardImage's cascade, for non-image
 * content (preview cards, rows) that has no load event to key off of.
 * Triggers on mount via a double rAF so the initial opacity:0 frame paints
 * before the transition starts.
 */
export function useFadeIn(index?: number): CSSProperties {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setLoaded(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);

  const delayMs = index != null ? index * STAGGER_MS : 0;
  return {
    opacity: loaded ? 1 : 0,
    transform: loaded ? "translateY(0)" : "translateY(-4%)",
    transition: "opacity 300ms ease-out, transform 300ms ease-out",
    transitionDelay: loaded ? `${delayMs}ms` : "0ms",
  };
}
