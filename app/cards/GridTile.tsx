"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cardImageFallbacks, cardImageSmall } from "@/lib/cardImages";
import type { CardIndexEntry } from "@/lib/cardsIndex";
import CardImage from "./CardImage";
import AddToListOverlay from "./AddToListOverlay";
import SelectionCircle from "./SelectionCircle";
import { useInventory } from "./InventoryContext";
import { InventoryCapsule, InventoryOverlay, type InventoryMenuMode } from "./InventoryCapsule";

export function formatGridPrice(p: number): string {
  if (!p || p <= 0) return "—";
  if (p >= 1000) return `$${Math.round(p).toLocaleString()}`;
  return `$${p.toFixed(2)}`;
}

function padNumber(n: string): string {
  const m = n.match(/^(\d+)(.*)$/);
  if (!m) return n;
  return m[1].padStart(3, "0") + m[2];
}

/** Breathing room the centred card number must keep from the set tag on its
 *  left and the add-to-list button on its right before it's faded out. */
const FOOTER_MIN_GAP_PX = 6;

/**
 * Hides the footer's centred card number when the tile is too narrow for it
 * to sit clear of the set tag and the list button.
 *
 * Measured rather than driven off a width breakpoint because the tag's width
 * is content-dependent: set codes in the catalog run from 2 to 11 characters
 * ("PBL" vs "SWSH12PT5GG"), so the tile width at which the number starts to
 * collide moves by ~100px depending on the card. A single px threshold would
 * either hide the number early on most cards or let it overlap on the long
 * ones.
 *
 * Stable because hiding is done with `opacity`, which leaves the number's box
 * in layout — so the rects measured here don't change when it's hidden, and
 * the observer can't oscillate between the two states.
 */
function useNumberCrowded(
  footerRef: React.RefObject<HTMLElement>,
  tagRef: React.RefObject<HTMLElement>,
  numberRef: React.RefObject<HTMLElement>,
  buttonRef: React.RefObject<HTMLElement>,
) {
  const [crowded, setCrowded] = useState(false);

  const measure = useCallback(() => {
    const tag = tagRef.current;
    const num = numberRef.current;
    const btn = buttonRef.current;
    if (!tag || !num || !btn) return;
    const t = tag.getBoundingClientRect();
    const n = num.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    setCrowded(
      n.left - t.right < FOOTER_MIN_GAP_PX || b.left - n.right < FOOTER_MIN_GAP_PX,
    );
  }, [tagRef, numberRef, buttonRef]);

  useEffect(() => {
    const footer = footerRef.current;
    if (!footer) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(footer);
    return () => ro.disconnect();
  }, [footerRef, measure]);

  return crowded;
}

/**
 * One card catalog grid tile — image, set/number footer that doubles as
 * the add-to-list trigger, price, and +/- collection controls. The
 * add-to-list picker and the +/- variant picker share one in-card overlay
 * language (AddToListOverlay / InventoryOverlay's "card" display) and are
 * mutually exclusive — opening one closes the other. When a toolbar's
 * Select mode is active (selectMode), tapping the tile toggles selection
 * instead of navigating, and a SelectionCircle appears in the corner.
 * Shared by the /cards catalog grid and the home page's catalog preview;
 * must be rendered inside an InventoryProvider (see InventoryContext.tsx).
 */
export default function GridTile({
  card: c,
  index,
  selectMode = false,
  selectionOrder = null,
  onToggleSelect,
}: {
  card: CardIndexEntry;
  index: number;
  /** When true, tapping the tile toggles selection instead of navigating. */
  selectMode?: boolean;
  /** This card's 1-indexed selection order, or null when not selected. */
  selectionOrder?: number | null;
  onToggleSelect?: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<InventoryMenuMode | null>(null);
  const [listPickerOpen, setListPickerOpen] = useState(false);
  const { signedIn } = useInventory();

  function handleFooterClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (signedIn !== true) {
      router.push(`/sign-in?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setMode(null);
    setListPickerOpen(true);
  }

  const numberLabel = c.setSize > 0 ? `${padNumber(c.number)}/${c.setSize}` : padNumber(c.number);

  const footerRef = useRef<HTMLDivElement>(null);
  const tagRef = useRef<HTMLSpanElement>(null);
  const numberRef = useRef<HTMLSpanElement>(null);
  const listButtonRef = useRef<HTMLButtonElement>(null);
  const numberCrowded = useNumberCrowded(footerRef, tagRef, numberRef, listButtonRef);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-full" style={{ aspectRatio: "245 / 342" }}>
        <Link
          href={`/cards/${encodeURIComponent(c.id)}`}
          onClick={(e) => {
            if (selectMode) {
              e.preventDefault();
              onToggleSelect?.();
            }
          }}
          className="group absolute inset-0 block rounded-xl overflow-hidden bg-surface hover:shadow-md transition-shadow"
        >
          <CardImage
            src={cardImageSmall(c.setId, c.number)}
            fallbackSrcs={cardImageFallbacks(c.setId, c.number)}
            alt={`${c.name} — ${c.setName} ${c.number}`}
            name={c.name}
            setName={c.setName}
            number={c.number}
            index={index}
            className="w-full h-full object-contain transition-transform group-hover:scale-[1.02]"
          />
          {selectMode && (
            <div className="absolute top-2 left-2 z-10">
              <SelectionCircle order={selectionOrder} />
            </div>
          )}
          <div
            ref={footerRef}
            className="absolute inset-x-0 bottom-0 h-[15%] min-h-[36px] flex items-center gap-2 px-2 bg-gradient-to-b from-transparent to-neutral-800 to-80% text-white text-[12.5px] font-semibold leading-none tabular-nums overflow-hidden pointer-events-none"
          >
            <span
              ref={tagRef}
              className="min-w-0 truncate rounded-md border border-white/70 bg-black px-0.5 py-0.5"
            >
              {(c.ptcgoCode || c.setId).toUpperCase()}
            </span>
            {/* Fades out rather than unmounting when the tile gets too narrow
                for all three to sit clear of each other — keeping the box in
                layout is what lets useNumberCrowded keep measuring it (see
                there). aria-hidden while faded so it isn't read out. */}
            <span
              ref={numberRef}
              aria-hidden={numberCrowded}
              className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 truncate transition-opacity duration-150 motion-reduce:transition-none ${
                numberCrowded ? "opacity-0" : "opacity-100"
              }`}
            >
              {numberLabel}
            </span>
            <button
              ref={listButtonRef}
              type="button"
              onClick={handleFooterClick}
              aria-label="Add to list"
              className="pointer-events-auto ml-auto shrink-0 flex items-center justify-center text-white/90 hover:text-white transition-colors"
            >
              {/* Same glyph as the header's Lists toggle (CardsClient.tsx),
                  without its circular button chrome. */}
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-4 h-4"
              >
                <path d="M7 5.5h9" />
                <path d="M7 10h9" />
                <path d="M7 14.5h9" />
                <path d="M4 5.5h.01" />
                <path d="M4 10h.01" />
                <path d="M4 14.5h.01" />
              </svg>
            </button>
          </div>
        </Link>
        {mode && (
          <InventoryOverlay
            setId={c.setId}
            number={c.number}
            variants={c.variants}
            mode={mode}
            display="card"
            onClose={() => setMode(null)}
          />
        )}
        {listPickerOpen && (
          <AddToListOverlay
            setId={c.setId}
            number={c.number}
            onClose={() => setListPickerOpen(false)}
          />
        )}
      </div>
      <div className="grid grid-cols-2 items-center w-full gap-2">
        <span className="text-xs font-semibold tabular-nums text-text-primary truncate pl-2">
          {formatGridPrice(c.marketPrice)}
        </span>
        <div className="justify-self-end">
          <InventoryCapsule
            setId={c.setId}
            number={c.number}
            onOpenMenu={(m) => {
              setListPickerOpen(false);
              setMode(m);
            }}
          />
        </div>
      </div>
    </div>
  );
}
