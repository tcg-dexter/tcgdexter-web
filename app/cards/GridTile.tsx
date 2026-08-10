"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cardImageSmall } from "@/lib/cardImages";
import type { CardIndexEntry } from "@/lib/cardsIndex";
import CardImage from "./CardImage";
import AddToListOverlay from "./AddToListOverlay";
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

/**
 * One card catalog grid tile — image, set/number footer that doubles as
 * the add-to-list trigger, price, and +/- collection controls. The
 * add-to-list picker and the +/- variant picker share one in-card overlay
 * language (AddToListOverlay / InventoryOverlay's "card" display) and are
 * mutually exclusive — opening one closes the other. Shared by the
 * /cards catalog grid and the home page's catalog preview; must be
 * rendered inside an InventoryProvider (see InventoryContext.tsx).
 */
export default function GridTile({ card: c, index }: { card: CardIndexEntry; index: number }) {
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

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-full" style={{ aspectRatio: "245 / 342" }}>
        <Link
          href={`/cards/${encodeURIComponent(c.id)}`}
          className="group absolute inset-0 block rounded-xl overflow-hidden bg-surface hover:shadow-md transition-shadow"
        >
          <CardImage
            src={cardImageSmall(c.setId, c.number)}
            alt={`${c.name} — ${c.setName} ${c.number}`}
            name={c.name}
            setName={c.setName}
            number={c.number}
            index={index}
            className="w-full h-full object-contain transition-transform group-hover:scale-[1.02]"
          />
          <button
            type="button"
            onClick={handleFooterClick}
            aria-label="Add to list"
            className="absolute inset-x-0 bottom-0 h-[15%] min-h-[36px] flex items-end justify-between gap-2 px-2 pb-2 bg-gradient-to-b from-transparent to-neutral-800 to-80% text-white text-[12.5px] font-semibold leading-none tabular-nums overflow-hidden text-left hover:to-neutral-700 transition-colors"
          >
            <span className="flex items-center gap-1 min-w-0">
              <span className="truncate rounded-md border border-white/70 bg-black px-0.5 py-0.5">
                {(c.ptcgoCode || c.setId).toUpperCase()}
              </span>
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0 w-3.5 h-3.5"
              >
                <path d="M5 3.5h10a.5.5 0 01.5.5v12.5l-5.5-3-5.5 3V4a.5.5 0 01.5-.5z" />
                <path d="M7.25 8h5.5M10 5.25v5.5" />
              </svg>
            </span>
            <span className="truncate mb-[3px]">{numberLabel}</span>
          </button>
        </Link>
        {mode && (
          <InventoryOverlay
            setId={c.setId}
            number={c.number}
            rarity={c.rarity}
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
