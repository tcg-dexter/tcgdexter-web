"use client";

import { COLLECTION_VARIANTS, type CollectionVariantKey } from "@/lib/inventory";
import { useInventory } from "./InventoryContext";

type Mode = "add" | "remove";

interface CapsuleProps {
  setId: string;
  number: string;
  /** Optional override; if not provided, the capsule manages its own menu state. */
  onOpenMenu?: (mode: Mode) => void;
}

/**
 * Pill with − / count / + buttons. Tapping + opens the variant picker
 * in add mode; − decrements the only present variant or, if multiple
 * are present, opens the picker in remove mode. The picker overlay is
 * rendered separately by InventoryOverlay so it can be positioned over
 * a different element (e.g. the card image above the capsule).
 */
export function InventoryCapsule({ setId, number, onOpenMenu }: CapsuleProps) {
  const { signedIn, totalFor, presentVariants, adjust, promptSignIn } = useInventory();
  const total = signedIn ? totalFor(setId, number) : 0;
  const present = signedIn ? presentVariants(setId, number) : [];

  function handleAdd(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (signedIn === null) return; // auth still resolving
    if (signedIn === false) {
      promptSignIn();
      return;
    }
    onOpenMenu?.("add");
  }

  function handleRemove(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (signedIn === null) return; // auth still resolving
    if (signedIn === false) {
      promptSignIn();
      return;
    }
    if (present.length === 0) return;
    if (present.length === 1) {
      void adjust(setId, number, present[0], -1);
      return;
    }
    onOpenMenu?.("remove");
  }

  return (
    <div
      className="inline-flex items-center gap-0 rounded-full border border-black/10 bg-white text-xs font-semibold select-none"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={handleRemove}
        disabled={signedIn === true && present.length === 0}
        aria-label="Remove from collection"
        className="h-[26px] w-[26px] flex items-center justify-center rounded-l-full hover:bg-surface disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
      >
        <span aria-hidden="true" className="leading-none">−</span>
      </button>
      <span className="min-w-[20px] text-center tabular-nums text-text-primary">
        {total}
      </span>
      <button
        type="button"
        onClick={handleAdd}
        aria-label="Add to collection"
        className="h-[26px] w-[26px] flex items-center justify-center rounded-r-full hover:bg-surface transition-colors"
      >
        <span aria-hidden="true" className="leading-none">+</span>
      </button>
    </div>
  );
}

/**
 * Variant picker overlay. Positioned absolutely; the nearest positioned
 * ancestor decides what it covers. Use rounded variants matching the
 * underlying target (rounded-xl for card images, rounded-2xl for list
 * row containers).
 */
export function InventoryOverlay({
  setId,
  number,
  mode,
  rounded,
  onClose,
}: {
  setId: string;
  number: string;
  mode: Mode;
  rounded: "xl" | "2xl";
  onClose: () => void;
}) {
  const { collection, adjust } = useInventory();
  const key = `${setId}::${number}`;
  const variantQty = collection[key] ?? {};

  function handleAdjust(variant: CollectionVariantKey, delta: number) {
    void adjust(setId, number, variant, delta);
  }

  const roundedClass = rounded === "2xl" ? "rounded-2xl" : "rounded-xl";

  return (
    <div
      className={`absolute inset-0 z-10 flex flex-col ${roundedClass} bg-black/85 backdrop-blur-sm p-2`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="flex items-center justify-between text-white text-[10px] uppercase tracking-wider font-semibold mb-1.5 px-1">
        <span>{mode === "add" ? "Add variant" : "Remove variant"}</span>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }}
          aria-label="Close"
          className="h-5 w-5 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"
        >
          <span aria-hidden="true" className="leading-none">×</span>
        </button>
      </div>
      <ul
        className="flex-1 overflow-y-auto flex flex-col gap-1"
        onClick={(e) => e.stopPropagation()}
      >
        {COLLECTION_VARIANTS.map((v) => {
          const qty = variantQty[v.key] ?? 0;
          if (mode === "remove" && qty <= 0) return null;
          return (
            <li
              key={v.key}
              className="flex items-center justify-between gap-2 px-1.5 py-1 rounded-md bg-white/10"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold text-white leading-tight truncate">
                  {v.label}
                </div>
                <div className="text-[10px] text-white/60 leading-tight tabular-nums">
                  {qty} owned
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleAdjust(v.key, mode === "add" ? 1 : -1);
                }}
                aria-label={`${mode === "add" ? "Add" : "Remove"} ${v.label}`}
                className="h-6 w-6 flex items-center justify-center rounded-full bg-white text-black text-xs font-semibold hover:bg-white/90 transition-colors flex-shrink-0"
              >
                <span aria-hidden="true" className="leading-none">
                  {mode === "add" ? "+" : "−"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export type InventoryMenuMode = Mode;
