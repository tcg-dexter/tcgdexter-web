"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import CardImage from "@/app/cards/CardImage";
import DeckTileFooter from "@/app/components/DeckTileFooter";

export interface ResolvedTile {
  key: string;
  name: string;
  copyCount: number;
  section: "pokemon" | "trainer" | "energy";
  entryId: string | null;
  setName: string;
  number: string;
  smallImageUrl: string;
  largeImageUrl: string;
}

/**
 * Client wrapper around the deck card grid. Tile taps no longer navigate
 * directly to /cards/[id] — instead they open a modal viewer with the
 * large card image, prev/next chevrons, close button, and a Details link
 * to the card's detail page. Keyboard: ←/→ to step, Esc to close.
 *
 * The viewer wraps at the deck's boundaries (last → first, first → last)
 * since the grid is a finite, closed set.
 */
export default function DeckCardGridClient({ tiles }: { tiles: ResolvedTile[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const close = useCallback(() => setOpenIndex(null), []);
  const step = useCallback(
    (delta: number) => {
      setOpenIndex((i) => {
        if (i === null || tiles.length === 0) return i;
        const next = (i + delta + tiles.length) % tiles.length;
        return next;
      });
    },
    [tiles.length],
  );

  return (
    <>
      <div
        className="grid grid-cols-5 md:grid-cols-10 gap-3"
        aria-label="Deck cards"
      >
        {tiles.map((t, i) => {
          const alt = t.setName
            ? `${t.name} — ${t.setName} ${t.number}`
            : `${t.name} ${t.number}`;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setOpenIndex(i)}
              className="relative w-full rounded overflow-hidden bg-surface block transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-accent/50"
              style={{ aspectRatio: "245 / 342" }}
              aria-label={`Open ${t.name}`}
            >
              <CardImage
                src={t.smallImageUrl}
                alt={alt}
                name={t.name}
                setName={t.setName}
                number={t.number}
                className="w-full h-full object-contain"
              />
              <DeckTileFooter copyCount={t.copyCount} />
            </button>
          );
        })}
      </div>

      {openIndex !== null && (
        <CardViewerModal
          tile={tiles[openIndex]}
          onClose={close}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
        />
      )}
    </>
  );
}

function CardViewerModal({
  tile,
  onClose,
  onPrev,
  onNext,
}: {
  tile: ResolvedTile;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  // Keyboard navigation + body scroll lock while the viewer is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") onPrev();
      else if (e.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Hide the page's shared BackButton while the viewer is up — handled
    // by a CSS rule on `body.card-viewer-open` in globals.css.
    document.body.classList.add("card-viewer-open");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      document.body.classList.remove("card-viewer-open");
    };
  }, [onClose, onPrev, onNext]);

  if (typeof document === "undefined") return null;

  const alt = tile.setName
    ? `${tile.name} — ${tile.setName} ${tile.number}`
    : `${tile.name} ${tile.number}`;

  return createPortal(
    // Dim layer positioned to exactly span the main content column:
    // full width on mobile/tablet, and inset by the 230px sidebars on
    // xl+ desktop (matches `xl:pl-[230px] xl:pr-[230px]` on the root
    // layout). The sidebars themselves stay uncovered and interactive.
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${tile.name} preview`}
      className="fixed inset-y-0 left-0 right-0 xl:left-[230px] xl:right-[230px] z-50 flex flex-col items-center justify-center p-4"
      style={{ backgroundColor: "rgba(242, 242, 242, 0.8)" }}
      onClick={onClose}
    >
      {/* Close — top-left of the dim layer. z-10 keeps it above the
          flex-centered content div (which is static and would otherwise
          paint after this absolutely-positioned sibling). */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close card viewer"
        className="absolute top-4 left-4 z-10 w-10 h-10 rounded-full bg-black/50 backdrop-blur-md text-white flex items-center justify-center hover:bg-black/70 transition"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.75}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <div className="w-full flex flex-col items-center justify-center gap-5">
        {/* Card + chevrons row. stopPropagation so taps on the card or
            chevrons don't bubble to the backdrop and dismiss. */}
        <div
          className="relative flex items-center justify-center gap-3 sm:gap-6 w-full"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={onPrev}
            aria-label="Previous card"
            className="shrink-0 w-11 h-11 rounded-full bg-black/50 backdrop-blur-md text-white flex items-center justify-center hover:bg-black/70 transition"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.75}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* Card box. Aspect ratio alone gives no intrinsic size inside a
              flex row, so we set an explicit height (clamped against the
              viewport width so the box doesn't overflow past the chevrons
              on narrow screens). Width is derived from aspect-ratio.
              65vh leaves headroom below for the Details button. */}
          <div
            className="relative rounded-xl overflow-hidden shadow-[0_20px_60px_-15px_rgba(0,0,0,0.6)] bg-[var(--surface)]"
            style={{
              height: "min(65vh, calc((100vw - 8rem) * 342 / 245))",
              aspectRatio: "245 / 342",
            }}
          >
            <CardImage
              src={tile.largeImageUrl}
              alt={alt}
              name={tile.name}
              setName={tile.setName}
              number={tile.number}
              loading="eager"
              decoding="sync"
              fetchPriority="high"
              className="w-full h-full object-contain"
            />
          </div>

          <button
            type="button"
            onClick={onNext}
            aria-label="Next card"
            className="shrink-0 w-11 h-11 rounded-full bg-black/50 backdrop-blur-md text-white flex items-center justify-center hover:bg-black/70 transition"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.75}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Details button — links to the card's detail page. Suppressed when
            the card is unresolved (no entry in the index), since there's no
            page to send the user to. */}
        <div
          className="flex items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          {tile.entryId ? (
            <Link
              href={`/cards/${encodeURIComponent(tile.entryId)}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-black text-white text-sm font-semibold px-5 py-2 shadow-md hover:bg-black/85 transition"
            >
              Details
            </Link>
          ) : (
            <span className="text-xs text-white/70">No details available</span>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
