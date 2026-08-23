"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  /** Opens the battle's edit form. The caller owns the form, since it also
   *  owns the raw battle row the form needs to prefill. */
  onEdit: () => void;
  /** Runs after the user confirms. Deletion itself is the caller's, so it
   *  can drop the card from its own list optimistically. */
  onDelete: () => void;
}

/**
 * Ellipsis (⋯) menu pinned to the top-right of a battle preview card on the
 * deck profile's history rail — Edit and Delete for the battle it sits on.
 *
 * Mirrors DeckCardMenu: the dropdown and the confirm dialog are portalled to
 * the body so the card's `overflow-hidden` doesn't clip them, and the
 * trigger stops click propagation so it never falls through to the card's
 * link overlay.
 */
export default function BattleCardMenu({ onEdit, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(
    null,
  );

  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Position the portalled menu against the trigger's bounding rect, then
  // keep it pinned while open. The rail scrolls horizontally, so `scroll`
  // is captured (third arg) to catch the scroller itself, not just window.
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
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
    };
  }, [open]);

  // Close on outside click / Escape. The menu is portalled outside
  // buttonRef, so check both the trigger and the menu element.
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
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-label="Battle actions"
        aria-haspopup="menu"
        aria-expanded={open}
        // White on the card's coloured gradient zone, with a scrim behind it
        // so it stays legible over pale card art.
        className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-black/25 text-white backdrop-blur-sm hover:bg-black/40 transition-colors touch-manipulation"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.75" />
          <circle cx="12" cy="12" r="1.75" />
          <circle cx="19" cy="12" r="1.75" />
        </svg>
      </button>

      {open && menuPos !== null && typeof window !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", top: menuPos.top, right: menuPos.right }}
            className="w-40 rounded-xl bg-white dark:bg-surface-elevated border border-black/8 dark:border-white/10 shadow-lg p-1 z-50"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
              className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-2 transition-colors"
            >
              Edit battle
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setConfirming(true);
              }}
              className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-accent hover:bg-surface-2 transition-colors"
            >
              Delete battle
            </button>
          </div>,
          document.body,
        )}

      {confirming && typeof window !== "undefined" &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-battle-title"
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={() => setConfirming(false)}
          >
            <div
              className="w-full max-w-sm rounded-2xl bg-white/95 dark:bg-surface-elevated backdrop-blur-xl border border-black/5 dark:border-white/10 p-6 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.4)]"
              onClick={(e) => e.stopPropagation()}
            >
              <h2
                id="delete-battle-title"
                className="text-base font-semibold text-text-primary"
              >
                Delete this battle?
              </h2>
              <p className="mt-2 text-sm text-text-secondary">This cannot be undone.</p>
              <div className="mt-5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="inline-flex items-center justify-center rounded-full border border-black/10 bg-white dark:bg-surface-2 px-4 py-1.5 text-xs font-semibold text-text-secondary hover:bg-black/5 transition touch-manipulation"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(false);
                    onDelete();
                  }}
                  className="inline-flex items-center justify-center rounded-full bg-black dark:bg-white px-4 py-1.5 text-xs font-semibold text-white dark:text-black hover:opacity-80 transition-opacity touch-manipulation"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
