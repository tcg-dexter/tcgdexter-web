"use client";

import { useState } from "react";
import Link from "next/link";
import { cardImageFallbacks, cardImageSmall } from "@/lib/cardImages";
import type { CardIndexEntry } from "@/lib/cardsIndex";
import type { GridColumns } from "@/app/components/ui/GridDensityMenu";
import CardImage from "./CardImage";
import GridTile from "./GridTile";
import SelectionCircle from "./SelectionCircle";
import {
  InventoryCapsule,
  InventoryOverlay,
  type InventoryMenuMode,
} from "./InventoryCapsule";

/**
 * The card grid/list presentation shared by the catalog page (`CardsClient`)
 * and the list-detail page (`/u/[username]/lists/[shortId]`) — extracted out
 * of CardsClient.tsx (where GridView/ListView/ListRow were private) so a
 * list's cards render with the exact same UI, price, and inventory controls
 * as the catalog. Must be rendered inside <InventoryProvider> — GridTile and
 * ListRow both call useInventory().
 */

/** Multi-select props shared by GridView and ListView — see SelectionCircle. */
export interface SelectionProps {
  selectMode?: boolean;
  /** Card id -> 1-indexed selection order. */
  selectedOrder?: Map<string, number>;
  onToggleSelect?: (card: CardIndexEntry) => void;
}

/**
 * Fixed column counts for the grid-density control. Tailwind's JIT only
 * emits classes it can see as complete literals, so `grid-cols-${n}` would
 * silently produce an unstyled grid — hence the explicit map.
 */
const COLUMN_CLASS: Record<GridColumns, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
};

/** Default when no column count is pinned — the card catalog relies on it. */
const RESPONSIVE_COLUMNS =
  "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6";

export function GridView({
  cards,
  columns,
  selectMode,
  selectedOrder,
  onToggleSelect,
}: {
  cards: CardIndexEntry[];
  /** Pin the grid to this many cards per row at every breakpoint. Omit to
   *  keep the responsive default. */
  columns?: GridColumns;
} & SelectionProps) {
  return (
    <div
      className={`grid ${columns ? COLUMN_CLASS[columns] : RESPONSIVE_COLUMNS} gap-3`}
    >
      {cards.map((c, i) => (
        <GridTile
          key={c.id}
          card={c}
          index={i}
          selectMode={selectMode}
          selectionOrder={selectedOrder?.get(c.id) ?? null}
          onToggleSelect={() => onToggleSelect?.(c)}
        />
      ))}
    </div>
  );
}

export function ListView({
  cards,
  selectMode,
  selectedOrder,
  onToggleSelect,
}: { cards: CardIndexEntry[] } & SelectionProps) {
  return (
    <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white dark:bg-surface-elevated overflow-hidden">
      <div className="hidden md:grid grid-cols-[64px_2fr_1.5fr_80px_80px_80px_80px_100px] gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted border-b border-black/8 dark:border-white/10">
        <span></span>
        <span>Name</span>
        <span>Set</span>
        <span>Number</span>
        <span>Type</span>
        <span>HP</span>
        <span className="text-right">Price</span>
        <span className="text-right">Owned</span>
      </div>
      <ul>
        {cards.map((c, i) => (
          <ListRow
            key={c.id}
            card={c}
            index={i}
            isFirst={i === 0}
            selectMode={selectMode}
            selectionOrder={selectedOrder?.get(c.id) ?? null}
            onToggleSelect={() => onToggleSelect?.(c)}
          />
        ))}
      </ul>
    </div>
  );
}

function ListRow({
  card: c,
  index,
  isFirst,
  selectMode = false,
  selectionOrder = null,
  onToggleSelect,
}: {
  card: CardIndexEntry;
  index: number;
  isFirst: boolean;
  selectMode?: boolean;
  selectionOrder?: number | null;
  onToggleSelect?: () => void;
}) {
  const [mode, setMode] = useState<InventoryMenuMode | null>(null);
  return (
    <li className={`relative ${isFirst ? "" : "border-t border-black/8 dark:border-white/10"}`}>
      <Link
        href={`/cards/${encodeURIComponent(c.id)}`}
        onClick={(e) => {
          if (selectMode) {
            e.preventDefault();
            onToggleSelect?.();
          }
        }}
        className="grid grid-cols-[48px_1fr_auto] md:grid-cols-[64px_2fr_1.5fr_80px_80px_80px_80px_100px] gap-3 px-4 py-2 items-center hover:bg-surface transition-colors"
      >
        <div className="relative shrink-0">
          <CardImage
            src={cardImageSmall(c.setId, c.number)}
            fallbackSrcs={cardImageFallbacks(c.setId, c.number)}
            alt={`${c.name} — ${c.setName} ${c.number}`}
            name={c.name}
            setName={c.setName}
            number={c.number}
            index={index}
            className="w-12 h-[68px] md:w-14 md:h-[78px] object-cover rounded-md bg-surface text-[9px]"
          />
          {selectMode && (
            <div className="absolute -top-1 -left-1">
              <SelectionCircle order={selectionOrder} />
            </div>
          )}
        </div>
        <div className="md:contents">
          <span className="text-sm font-medium text-text-primary truncate">{c.name}</span>
          <span className="hidden md:inline text-sm text-text-secondary truncate">
            {c.setName}
            {c.ptcgoCode ? ` · ${c.ptcgoCode}` : ""}
          </span>
          <span className="hidden md:inline text-sm text-text-secondary">{c.number}</span>
          <span className="hidden md:inline text-sm text-text-secondary">
            {c.types.join(", ") || c.supertype}
          </span>
          <span className="hidden md:inline text-sm text-text-secondary">{c.hp ?? "—"}</span>
          <span className="hidden md:inline text-sm text-text-secondary text-right">
            {c.marketPrice > 0 ? `$${c.marketPrice.toFixed(2)}` : "—"}
          </span>
        </div>
        <div className="justify-self-end md:justify-self-end">
          <InventoryCapsule
            setId={c.setId}
            number={c.number}
            onOpenMenu={(m) => setMode(m)}
          />
        </div>
      </Link>
      {mode && (
        <InventoryOverlay
          setId={c.setId}
          number={c.number}
          variants={c.variants}
          cardName={c.name}
          mode={mode}
          display="modal"
          onClose={() => setMode(null)}
        />
      )}
    </li>
  );
}
