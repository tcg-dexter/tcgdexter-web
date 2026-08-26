"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Cards per row a grid can be pinned to. */
export type GridColumns = 2 | 3 | 4 | 5 | 6;

const OPTIONS: GridColumns[] = [2, 3, 4, 5, 6];

interface Props {
  /** Current pinned column count, or undefined while the grid is still on
   *  its responsive default (nothing is shown as checked in that case). */
  value?: GridColumns;
  onChange: (columns: GridColumns) => void;
}

/**
 * Icon-only "grid density" control: a 3×3 glyph that opens a small menu for
 * choosing how many cards sit in each grid row. Meant to sit immediately
 * right of `GridListToggle` in a toolbar, so it matches the shared 38-px rail
 * height and the Filters button's chrome rather than the usual icon-button
 * `py-[7px]` padding — visual alignment with its neighbours wins here.
 *
 * Follows the repo's dropdown idiom (see BattleCardMenu / DeckCardMenu): the
 * menu is portalled to `document.body` so no ancestor's overflow clips it,
 * positioned against the trigger's rect in a layout effect and re-pinned on
 * scroll/resize, and closed by outside pointerdown or Escape.
 *
 * Deliberately stateless about persistence — the caller owns `value`, since
 * where the choice is remembered (per list, per page, not at all) differs by
 * callsite.
 */
export default function GridDensityMenu({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(
    null,
  );

  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    function compute() {
      const btn = buttonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    }
    compute();
    // Captured `scroll` so a scrolling ancestor (not just the window) also
    // re-pins the menu.
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
    };
  }, [open]);

  // The menu is portalled outside buttonRef, so an outside click has to be
  // measured against both the trigger and the menu element.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (
        !buttonRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Cards per row"
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center justify-center h-[38px] w-[38px] rounded-full border border-black/10 bg-white dark:bg-surface-2 text-text-primary hover:bg-surface transition-colors"
      >
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <rect x="0" y="0" width="4" height="4" rx="1" />
          <rect x="6" y="0" width="4" height="4" rx="1" />
          <rect x="12" y="0" width="4" height="4" rx="1" />
          <rect x="0" y="6" width="4" height="4" rx="1" />
          <rect x="6" y="6" width="4" height="4" rx="1" />
          <rect x="12" y="6" width="4" height="4" rx="1" />
          <rect x="0" y="12" width="4" height="4" rx="1" />
          <rect x="6" y="12" width="4" height="4" rx="1" />
          <rect x="12" y="12" width="4" height="4" rx="1" />
        </svg>
      </button>

      {open &&
        menuPos !== null &&
        typeof window !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Cards per row"
            style={{ position: "fixed", top: menuPos.top, right: menuPos.right }}
            className="w-40 rounded-xl bg-white dark:bg-surface-elevated border border-black/8 dark:border-white/10 shadow-lg p-1 z-50"
          >
            {OPTIONS.map((n) => {
              const on = value === n;
              return (
                <button
                  key={n}
                  type="button"
                  role="menuitemradio"
                  aria-checked={on}
                  onClick={() => {
                    onChange(n);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-surface-2 ${
                    on ? "text-text-primary" : "text-text-secondary"
                  }`}
                >
                  <span>{n} per row</span>
                  {on && (
                    <svg
                      className="w-3.5 h-3.5 text-accent"
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="m4 10.5 4 4 8-9" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
