"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MetaVariantCard from "@/app/meta-archetypes/[slug]/MetaVariantCard";
import type { CardAppearance } from "@/lib/cardAppearances";

interface Props {
  setCode: string;
  number: string;
  initialItems: CardAppearance[];
  initialHasMore: boolean;
  batchSize?: number;
}

const DEFAULT_BATCH = 10;
const DESKTOP_MQ = "(min-width: 768px)";

/**
 * Horizontal-scroll carousel of meta deck variants that include the card
 * currently being viewed. Cards size to 1-per-viewport on mobile and
 * 3-per-viewport on desktop. Free-scroll stays available; the chevron
 * buttons advance one (mobile) or three (desktop) tiles at a time,
 * locking the scroll position back onto a tile boundary.
 *
 * Server renders the first batch for fast paint; subsequent batches load
 * via the appears-in endpoint when the trailing sentinel approaches.
 */
export default function AppearsInCarousel({
  setCode,
  number,
  initialItems,
  initialHasMore,
  batchSize = DEFAULT_BATCH,
}: Props) {
  const [items, setItems] = useState<CardAppearance[]>(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const itemRef = useRef<HTMLLIElement | null>(null);
  const sentinelRef = useRef<HTMLLIElement | null>(null);
  const offsetRef = useRef(initialItems.length);

  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    setError(null);
    try {
      const url = new URL("/api/cards/appears-in", window.location.origin);
      url.searchParams.set("setCode", setCode);
      url.searchParams.set("number", number);
      url.searchParams.set("offset", String(offsetRef.current));
      url.searchParams.set("limit", String(batchSize));
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        items: CardAppearance[];
        hasMore: boolean;
      };
      offsetRef.current += data.items.length;
      setItems((prev) => [...prev, ...data.items]);
      setHasMore(data.hasMore);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [setCode, number, batchSize, loading, hasMore]);

  // Sentinel-driven lazy fetch (200px rootMargin so the next batch starts
  // streaming before the user hits the visible edge).
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { root: null, rootMargin: "200px", threshold: 0 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [loadMore, hasMore]);

  /** Measure the pitch (tile width + flex gap) so chevron steps land
   *  exactly on a tile boundary regardless of viewport width. */
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
  }, [updateEdges, items.length]);

  const step = useCallback(
    (direction: 1 | -1) => {
      const el = scrollerRef.current;
      const pitch = getPitch();
      if (!el || !pitch) return;
      const tilesPerView = window.matchMedia(DESKTOP_MQ).matches ? 3 : 1;
      // Round the current position to the nearest tile boundary, then
      // advance by N tiles. Snaps "back into" alignment whether or not
      // the user is currently mid-scroll between tiles.
      const aligned = Math.round(el.scrollLeft / pitch) * pitch;
      const target = aligned + direction * tilesPerView * pitch;
      const max = el.scrollWidth - el.clientWidth;
      el.scrollTo({
        left: Math.max(0, Math.min(max, target)),
        behavior: "smooth",
      });
    },
    [getPitch],
  );

  if (items.length === 0) return null;

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-text-primary">Appears in</h2>
        <div className="flex items-center gap-1.5">
          <ChevronButton
            direction="left"
            disabled={atStart}
            onClick={() => step(-1)}
          />
          <ChevronButton
            direction="right"
            disabled={atEnd && !hasMore}
            onClick={() => step(1)}
          />
        </div>
      </div>
      <div
        ref={scrollerRef}
        className="overflow-x-auto snap-x snap-mandatory scroll-smooth no-scrollbar -mx-4 sm:-mx-6 px-4 sm:px-6 scroll-pl-4 sm:scroll-pl-6"
        aria-label="Deck lists that include this card"
      >
        <ul
          ref={listRef}
          className="flex gap-3 items-stretch"
        >
          {items.map((v, i) => (
            <li
              key={v.id}
              ref={i === 0 ? itemRef : undefined}
              className="shrink-0 basis-[90%] md:basis-[calc((100%-1.5rem)/3)] snap-start flex"
            >
              <div className="w-full">
                <MetaVariantCard
                  id={v.id}
                  href={v.href}
                  archetypeId={v.archetypeId}
                  archetypeName={v.archetypeName}
                  annotation={v.annotation}
                  variantName={v.variantName}
                  iconUrl={v.iconUrl}
                  iconBg={v.iconBg}
                  placingLine={v.placingLine}
                  competitionName={v.competitionName}
                  dateLine={v.dateLine}
                  creator={v.creator}
                  cardImageUrl={v.cardImageUrl}
                  counts={v.counts}
                  secondaryAvatars={v.secondaryAvatars}
                />
              </div>
            </li>
          ))}
          {hasMore && (
            <li
              ref={sentinelRef}
              className="shrink-0 w-1 self-stretch"
              aria-hidden
            />
          )}
        </ul>
      </div>
      {loading && (
        <p className="mt-2 text-xs text-text-muted">Loading more…</p>
      )}
      {error && (
        <p className="mt-2 text-xs text-accent">Couldn’t load more: {error}</p>
      )}
    </section>
  );
}

function ChevronButton({
  direction,
  disabled,
  onClick,
}: {
  direction: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === "left" ? "Previous decks" : "Next decks"}
      className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-black/10 bg-white text-text-primary disabled:text-text-muted disabled:bg-surface disabled:cursor-not-allowed hover:bg-surface transition-colors"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {direction === "left" ? (
          <polyline points="15 18 9 12 15 6" />
        ) : (
          <polyline points="9 18 15 12 9 6" />
        )}
      </svg>
    </button>
  );
}
