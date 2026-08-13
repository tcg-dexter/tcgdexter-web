"use client";

import { useCallback } from "react";
import ListPreviewCard from "../ListPreviewCard";
import CarouselChevron from "./CarouselChevron";
import { useCarousel } from "./useCarousel";
import type { ListSummary } from "@/lib/lists";

/**
 * Horizontal carousel of the viewer's own lists that already contain the
 * card being viewed. Sits between "Appears in" and "More by <artist>",
 * and mirrors the "Appears in" carousel's scroll/chevron behaviour.
 *
 * Tile widths match the Lists grid elsewhere (2 up on mobile, 3 at sm,
 * 4 from md) so a list card reads the same size here as on /cards and the
 * profile page. The whole set is server-rendered — a user has few enough
 * lists that there's nothing to paginate.
 */
export default function ListsCarousel({ lists }: { lists: ListSummary[] }) {
  const tilesPerView = useCallback(() => {
    if (typeof window === "undefined") return 2;
    if (window.matchMedia("(min-width: 768px)").matches) return 4;
    if (window.matchMedia("(min-width: 640px)").matches) return 3;
    return 2;
  }, []);

  const { scrollerRef, listRef, itemRef, atStart, atEnd, step } = useCarousel({
    tilesPerView,
    itemCount: lists.length,
  });

  if (lists.length === 0) return null;

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-text-primary">Lists</h2>
        <div className="flex items-center gap-1.5">
          <CarouselChevron
            direction="left"
            noun="lists"
            disabled={atStart}
            onClick={() => step(-1)}
          />
          <CarouselChevron
            direction="right"
            noun="lists"
            disabled={atEnd}
            onClick={() => step(1)}
          />
        </div>
      </div>
      <div
        ref={scrollerRef}
        className="overflow-x-auto snap-x snap-mandatory scroll-smooth no-scrollbar -mx-4 sm:-mx-6 px-4 sm:px-6 scroll-pl-4 sm:scroll-pl-6"
        aria-label="Your lists that include this card"
      >
        <ul ref={listRef} className="flex gap-3 items-stretch">
          {lists.map((l, i) => (
            <li
              key={l.id}
              ref={i === 0 ? itemRef : undefined}
              className="shrink-0 basis-[calc((100%-0.75rem)/2)] sm:basis-[calc((100%-1.5rem)/3)] md:basis-[calc((100%-2.25rem)/4)] snap-start flex"
            >
              <div className="w-full">
                <ListPreviewCard list={l} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
