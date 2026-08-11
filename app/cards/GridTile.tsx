"use client";

import { useState } from "react";
import Link from "next/link";
import { cardImageFallbacks, cardImageSmall } from "@/lib/cardImages";
import type { CardIndexEntry } from "@/lib/cardsIndex";
import CardImage from "./CardImage";
import CardFooterOverlay from "./CardFooterOverlay";
import { InventoryCapsule, InventoryOverlay, type InventoryMenuMode } from "./InventoryCapsule";

export function formatGridPrice(p: number): string {
  if (!p || p <= 0) return "—";
  if (p >= 1000) return `$${Math.round(p).toLocaleString()}`;
  return `$${p.toFixed(2)}`;
}

/**
 * One card catalog grid tile — image, set/number footer overlay, price,
 * and +/- collection controls. Shared by the /cards catalog grid and the
 * home page's catalog preview; must be rendered inside an
 * InventoryProvider (see InventoryContext.tsx).
 */
export default function GridTile({ card: c, index }: { card: CardIndexEntry; index: number }) {
  const [mode, setMode] = useState<InventoryMenuMode | null>(null);
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-full" style={{ aspectRatio: "245 / 342" }}>
        <Link
          href={`/cards/${encodeURIComponent(c.id)}`}
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
          <CardFooterOverlay
            setCode={c.ptcgoCode}
            setId={c.setId}
            number={c.number}
            setSize={c.setSize}
          />
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
      </div>
      <div className="grid grid-cols-2 items-center w-full gap-2">
        <span className="text-xs font-semibold tabular-nums text-text-primary truncate pl-2">
          {formatGridPrice(c.marketPrice)}
        </span>
        <div className="justify-self-end">
          <InventoryCapsule
            setId={c.setId}
            number={c.number}
            onOpenMenu={(m) => setMode(m)}
          />
        </div>
      </div>
    </div>
  );
}
