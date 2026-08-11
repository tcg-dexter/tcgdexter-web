"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  allowedAddVariants,
  variantDisplayLabel,
  type CollectionVariantKey,
} from "@/lib/inventory";
import { compareVariants, isSpecialPrinting } from "@/lib/variants";
import { useInventory } from "./InventoryContext";

const ADD_CELEBRATION_MS = 1250;
const CLOSE_FADE_MS = 200;

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
      className="inline-flex items-center gap-0 rounded-full border border-black/10 bg-white dark:bg-surface-2 text-xs font-semibold select-none"
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
 * Variant picker. In "card" mode it renders as a black overlay
 * absolutely positioned over the nearest positioned ancestor — used
 * by the grid tile to cover the card image. In "modal" mode it
 * renders as a fixed centered dialog with backdrop — used by list
 * rows, where there isn't enough vertical space to cover the row
 * meaningfully.
 */
export function InventoryOverlay({
  setId,
  number,
  variants,
  cardName,
  mode,
  display,
  onClose,
}: {
  setId: string;
  number: string;
  /** Canonical variant keys for this printing — the exact finishes it exists
   *  in. Empty/undefined when upstream hasn't described the card, in which
   *  case `allowedAddVariants` falls back to the universal finishes. */
  variants?: string[];
  cardName?: string;
  mode: Mode;
  display: "card" | "modal";
  onClose: () => void;
}) {
  const { collection, adjust } = useInventory();
  const key = `${setId}::${number}`;
  const variantQty = collection[key] ?? {};

  const [celebrating, setCelebrating] = useState<CollectionVariantKey | null>(null);
  const [showSpecial, setShowSpecial] = useState(false);
  const [closing, setClosing] = useState(false);
  const celebrateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (celebrateTimer.current) clearTimeout(celebrateTimer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  function handleAdjust(variant: CollectionVariantKey, delta: number) {
    void adjust(setId, number, variant, delta);
    if (mode === "add" && display === "card" && delta > 0) {
      setCelebrating(variant);
      if (celebrateTimer.current) clearTimeout(celebrateTimer.current);
      celebrateTimer.current = setTimeout(() => {
        setCelebrating(null);
        setClosing(true);
        if (closeTimer.current) clearTimeout(closeTimer.current);
        closeTimer.current = setTimeout(onClose, CLOSE_FADE_MS);
      }, ADD_CELEBRATION_MS);
    }
  }

  const title = mode === "add" ? "Add variant" : "Remove variant";

  /**
   * Add mode lists the printings the card actually exists in; remove mode
   * lists whatever is owned, so a finish recorded before we had variant data
   * (or imported in bulk) stays removable even if it's no longer offered.
   *
   * Plain finishes come first and stamped/foiled printings collapse behind a
   * toggle — Base-era holos have four printings and some promos carry several
   * stamps, which would otherwise bury the common case under a long list.
   */
  const { plain, special } = useMemo(() => {
    const keys =
      mode === "add"
        ? allowedAddVariants(variants)
        : Object.keys(variantQty).filter((k) => (variantQty[k] ?? 0) > 0);
    const rows = Array.from(new Set(keys)).sort(compareVariants).map((k) => ({
      key: k,
      label: variantDisplayLabel(k),
      qty: variantQty[k] ?? 0,
    }));
    return {
      plain: rows.filter((r) => !isSpecialPrinting(r.key)),
      special: rows.filter((r) => isSpecialPrinting(r.key)),
    };
  }, [mode, variants, variantQty]);

  // Nothing plain to show (a promo that only exists stamped) — don't hide the
  // only rows there are behind a toggle.
  const specialsCollapsible = plain.length > 0 && special.length > 0;
  const rows = specialsCollapsible && !showSpecial ? plain : [...plain, ...special];
  const hiddenCount = specialsCollapsible && !showSpecial ? special.length : 0;

  if (display === "modal") {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
      >
        <div
          className="w-full max-w-sm rounded-2xl bg-white dark:bg-surface-elevated p-5 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">
            {title}
          </div>
          {cardName && (
            <h2 className="mt-0.5 text-base font-semibold text-text-primary truncate">
              {cardName}
            </h2>
          )}
          <ul className="mt-3 flex flex-col gap-1.5">
            {rows.map((r) => (
              <li
                key={r.key}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-surface"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-text-primary leading-tight truncate">
                    {r.label}
                  </div>
                  <div className="text-xs text-text-secondary leading-tight tabular-nums">
                    {r.qty} owned
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleAdjust(r.key, mode === "add" ? 1 : -1);
                  }}
                  aria-label={`${mode === "add" ? "Add" : "Remove"} ${r.label}`}
                  className="h-8 w-8 flex items-center justify-center rounded-full bg-black dark:bg-white text-white dark:text-black text-sm font-semibold hover:bg-text-primary transition-colors flex-shrink-0"
                >
                  <span aria-hidden="true" className="leading-none">
                    {mode === "add" ? "+" : "−"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowSpecial(true);
              }}
              className="mt-2 w-full text-xs font-semibold text-text-secondary hover:text-text-primary py-1.5 rounded-lg hover:bg-surface transition-colors"
            >
              Show {hiddenCount} special printing{hiddenCount === 1 ? "" : "s"}
            </button>
          )}
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }}
              aria-label="Close"
              className="h-8 w-8 flex items-center justify-center rounded-full border border-black/30 dark:border-white/10 text-text-secondary hover:text-text-primary hover:border-black/60 dark:hover:border-white/20 hover:bg-surface transition-colors"
            >
              <span aria-hidden="true" className="leading-none text-base">×</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`absolute inset-0 z-10 flex flex-col rounded-xl bg-black/85 backdrop-blur-sm p-2 transition-opacity duration-200 ${
        closing ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="text-white text-[10px] uppercase tracking-wider font-semibold mb-1.5 px-1">
        {title}
      </div>
      <ul
        className="flex-1 overflow-y-auto flex flex-col gap-1"
        onClick={(e) => e.stopPropagation()}
      >
        {rows.map((r) => (
          <li
            key={r.key}
            className="flex items-center justify-between gap-2 px-1.5 py-1 rounded-md bg-white/10"
          >
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold text-white leading-tight truncate">
                {r.label}
              </div>
              <div className="text-[10px] text-white/60 leading-tight tabular-nums">
                {r.qty} owned
              </div>
            </div>
            {(() => {
              const isCelebrating = celebrating === r.key;
              return (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleAdjust(r.key, mode === "add" ? 1 : -1);
                  }}
                  disabled={isCelebrating}
                  aria-label={`${mode === "add" ? "Add" : "Remove"} ${r.label}`}
                  className="relative h-6 w-6 flex items-center justify-center rounded-full bg-white text-black text-xs font-semibold hover:bg-white/90 transition-colors flex-shrink-0 overflow-hidden disabled:cursor-default"
                >
                  <span
                    aria-hidden="true"
                    className={`absolute inset-0 rounded-full bg-gradient-brand transition-opacity duration-300 ${
                      isCelebrating ? "opacity-100" : "opacity-0"
                    }`}
                  />
                  <span
                    aria-hidden="true"
                    className={`relative leading-none transition-transform duration-300 ${
                      isCelebrating ? "[transform:rotateY(180deg)] text-white" : ""
                    }`}
                  >
                    {isCelebrating ? (
                      <svg
                        viewBox="0 0 16 16"
                        className="h-3 w-3 [transform:rotateY(180deg)]"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M3 8.5l3 3 7-7" />
                      </svg>
                    ) : (
                      mode === "add" ? "+" : "−"
                    )}
                  </span>
                </button>
              );
            })()}
          </li>
        ))}
        {hiddenCount > 0 && (
          <li>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowSpecial(true);
              }}
              className="w-full text-[10px] font-semibold text-white/70 hover:text-white py-1 rounded-md hover:bg-white/10 transition-colors"
            >
              Show {hiddenCount} special printing{hiddenCount === 1 ? "" : "s"}
            </button>
          </li>
        )}
      </ul>
      <div className="mt-1.5 flex justify-center">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }}
          aria-label="Close"
          className="h-7 w-7 flex items-center justify-center rounded-full border border-white/60 text-white/80 hover:text-white hover:border-white hover:bg-white/10 transition-colors"
        >
          <span aria-hidden="true" className="leading-none text-sm">×</span>
        </button>
      </div>
    </div>
  );
}

export type InventoryMenuMode = Mode;
