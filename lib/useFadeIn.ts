"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

const STAGGER_MS = 15;

/**
 * Fade-in entrance matching CardImage's cascade, for non-image content
 * (preview cards, rows) that has no load event to key off of. Triggers
 * on mount via a double rAF so the initial opacity:0 frame paints before
 * the transition starts.
 *
 * Pass `skip: true` to render already-visible with no animation — for
 * remounts that aren't the page's true first paint (e.g. toggling
 * grid/list view, which unmounts and remounts these cards).
 */
export function useFadeIn(index?: number, skip = false): CSSProperties {
  const [loaded, setLoaded] = useState(skip);

  useEffect(() => {
    if (skip) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setLoaded(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [skip]);

  const delayMs = index != null ? index * STAGGER_MS : 0;
  return {
    opacity: loaded ? 1 : 0,
    transition: "opacity 300ms ease-out",
    transitionDelay: loaded ? `${delayMs}ms` : "0ms",
  };
}
