"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import NewListDialog from "./NewListDialog";
import { useListPicker } from "./useListPicker";

interface Props {
  setId: string;
  number: string;
  isAuthenticated: boolean;
}

/**
 * Circular "add to list" trigger for the card detail page's title row.
 * Signed-out clicks redirect to sign-in (mirrors FollowButton). Signed-in
 * opens a portalled checkbox picker over the caller's lists — same
 * positioning convention as DeckCardMenu's dropdown — with optimistic
 * toggles against POST/DELETE /api/lists/[id]/items, plus a trailing
 * "+ New list" row.
 *
 * The catalog grid tile uses a different presentation for the same
 * picker data (AddToListOverlay, an in-card overlay) — see useListPicker.
 */
export default function AddToListButton({ setId, number, isAuthenticated }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const { state, toggle, addCreatedList } = useListPicker(setId, number, open);

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

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) {
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

  function handleTrigger() {
    if (!isAuthenticated) {
      router.push(`/sign-in?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setOpen((o) => !o);
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleTrigger}
        aria-label="Add to list"
        aria-haspopup={isAuthenticated ? "menu" : undefined}
        aria-expanded={isAuthenticated ? open : undefined}
        className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full border border-black/10 bg-white dark:bg-surface-2 text-text-primary hover:bg-surface transition-colors"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="w-3.5 h-3.5"
        >
          <path d="M10 4v12M4 10h12" />
        </svg>
      </button>

      {open &&
        menuPos !== null &&
        typeof window !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", top: menuPos.top, right: menuPos.right }}
            className="w-56 rounded-xl bg-white dark:bg-surface-elevated border border-black/8 dark:border-white/10 shadow-lg p-1 z-50"
          >
            {state.loading ? (
              <p className="px-3 py-2 text-sm text-text-secondary">Loading…</p>
            ) : !state.hasUsername ? (
              <p className="px-3 py-2 text-sm text-text-secondary">
                <Link href="/welcome" className="font-semibold text-accent hover:underline">
                  Set a username
                </Link>{" "}
                to start creating lists.
              </p>
            ) : (
              <>
                {state.lists.length === 0 && (
                  <p className="px-3 py-2 text-sm text-text-secondary">No lists yet.</p>
                )}
                {state.lists.map((l) => (
                  <label
                    key={l.id}
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-2 transition-colors cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={!!l.containsCard}
                      onChange={() => toggle(l)}
                      className="w-4 h-4 rounded border-black/20 accent-accent"
                    />
                    <span className="truncate flex-1">{l.name}</span>
                  </label>
                ))}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setDialogOpen(true);
                    setOpen(false);
                  }}
                  className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-accent hover:bg-surface-2 transition-colors"
                >
                  + New list
                </button>
              </>
            )}
          </div>,
          document.body,
        )}

      <NewListDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        cardToAdd={{ setId, number }}
        onCreated={addCreatedList}
      />
    </>
  );
}
