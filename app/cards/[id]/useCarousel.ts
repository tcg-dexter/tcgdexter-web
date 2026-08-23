"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Options {
  /** Tiles to advance per chevron press, evaluated at click time so it can
   *  read the current breakpoint. */
  tilesPerView: () => number;
  /** Re-measures the scroll edges whenever this changes (tile count). */
  itemCount: number;
}

/**
 * Scroll mechanics shared by the app's horizontal carousels — the card
 * detail page's "Appears in" and "Lists", and the deck profile's Battle
 * History rail: tracks whether the scroller is pinned at either end (so
 * chevrons can disable) and steps by whole tiles, snapping back onto a tile
 * boundary even if the user left it mid-scroll.
 *
 * Attach `scrollerRef` to the overflow container, `listRef` to the flex
 * list, and `itemRef` to the first tile — the pitch (tile width + gap) is
 * measured from those rather than hard-coded, so it stays correct at every
 * breakpoint.
 */
export function useCarousel({ tilesPerView, itemCount }: Options) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const itemRef = useRef<HTMLLIElement | null>(null);

  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const getPitch = useCallback((): number => {
    const item = itemRef.current;
    const list = listRef.current;
    if (!item || !list) return 0;
    const gap = parseFloat(getComputedStyle(list).columnGap || "0") || 0;
    return item.getBoundingClientRect().width + gap;
  }, []);

  const updateEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    updateEdges();
    el.addEventListener("scroll", updateEdges, { passive: true });
    window.addEventListener("resize", updateEdges);
    return () => {
      el.removeEventListener("scroll", updateEdges);
      window.removeEventListener("resize", updateEdges);
    };
  }, [updateEdges, itemCount]);

  const step = useCallback(
    (direction: 1 | -1) => {
      const el = scrollerRef.current;
      const pitch = getPitch();
      if (!el || !pitch) return;
      // Round the current position to the nearest tile boundary, then
      // advance by N tiles. Snaps "back into" alignment whether or not
      // the user is currently mid-scroll between tiles.
      const aligned = Math.round(el.scrollLeft / pitch) * pitch;
      const target = aligned + direction * tilesPerView() * pitch;
      const max = el.scrollWidth - el.clientWidth;
      el.scrollTo({
        left: Math.max(0, Math.min(max, target)),
        behavior: "smooth",
      });
    },
    [getPitch, tilesPerView],
  );

  return { scrollerRef, listRef, itemRef, atStart, atEnd, step };
}
