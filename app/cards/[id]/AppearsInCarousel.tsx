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

/**
 * Horizontal-scroll carousel of meta deck variants that include the card
 * currently being viewed. The first batch is server-rendered for fast
 * paint; subsequent batches are pulled on demand as the rightmost
 * sentinel scrolls into view.
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
  const sentinelRef = useRef<HTMLLIElement | null>(null);
  const offsetRef = useRef(initialItems.length);

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

  // IntersectionObserver wired to the trailing sentinel — fires the next
  // batch as soon as the user scrolls within ~200px of the end of the row.
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

  if (items.length === 0) return null;

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold text-text-primary mb-3">
        Appears in
      </h2>
      <div
        className="overflow-x-auto snap-x scroll-smooth no-scrollbar -mx-4 sm:-mx-6 px-4 sm:px-6"
        aria-label="Deck lists that include this card"
      >
        <ul className="flex gap-3 items-stretch">
          {items.map((v) => (
            <li
              key={v.id}
              className="shrink-0 w-[320px] sm:w-[340px] snap-start flex"
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
