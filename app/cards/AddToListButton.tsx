"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import NewListDialog from "./NewListDialog";
import type { ListSummary } from "@/lib/lists";

interface Props {
  setId: string;
  number: string;
  isAuthenticated: boolean;
  /**
   * "icon" (default) — the circular trigger on the card detail page's
   * title row. "footer" — the full-width strip layered over a catalog
   * grid tile's image, replacing CardFooterOverlay: the whole strip is
   * the tap target, with the set-code badge, this trigger's icon, and
   * the card number all rendered inside it. Requires setCode/setSize.
   */
  variant?: "icon" | "footer";
  setCode?: string | null;
  setSize?: number;
}

interface PickerState {
  loading: boolean;
  lists: ListSummary[];
  hasUsername: boolean;
}

function padNumber(n: string): string {
  const m = n.match(/^(\d+)(.*)$/);
  if (!m) return n;
  return m[1].padStart(3, "0") + m[2];
}

/**
 * "Add to list" trigger. Signed-out clicks redirect to sign-in (mirrors
 * FollowButton). Signed-in opens a portalled checkbox picker over the
 * caller's lists — same positioning convention as DeckCardMenu's dropdown —
 * with optimistic toggles against POST/DELETE /api/lists/[id]/items, plus
 * a trailing "+ New list" row.
 */
export default function AddToListButton({
  setId,
  number,
  isAuthenticated,
  variant = "icon",
  setCode = null,
  setSize = 0,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PickerState>({ loading: false, lists: [], hasUsername: true });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

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

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    fetch(`/api/lists?setId=${encodeURIComponent(setId)}&number=${encodeURIComponent(number)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load lists"))))
      .then((data: { lists: ListSummary[]; hasUsername: boolean }) => {
        if (cancelled) return;
        setState({ loading: false, lists: data.lists, hasUsername: data.hasUsername });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ loading: false, lists: [], hasUsername: true });
      });
    return () => {
      cancelled = true;
    };
  }, [open, setId, number]);

  // preventDefault/stopPropagation so this works nested inside a card
  // Link (the footer variant sits inside the catalog grid tile's Link to
  // the card detail page) without also triggering navigation — same
  // convention InventoryCapsule uses nested inside ListRow's Link.
  function handleTrigger(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!isAuthenticated) {
      router.push(`/sign-in?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setOpen((o) => !o);
  }

  async function toggle(list: ListSummary) {
    const nextContains = !list.containsCard;
    setState((s) => ({
      ...s,
      lists: s.lists.map((l) => (l.id === list.id ? { ...l, containsCard: nextContains } : l)),
    }));
    try {
      const url = nextContains
        ? `/api/lists/${list.id}/items`
        : `/api/lists/${list.id}/items?setId=${encodeURIComponent(setId)}&number=${encodeURIComponent(number)}`;
      const res = await fetch(url, {
        method: nextContains ? "POST" : "DELETE",
        ...(nextContains
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ setId, number }),
            }
          : {}),
      });
      if (!res.ok) throw new Error("failed");
    } catch {
      setState((s) => ({
        ...s,
        lists: s.lists.map((l) => (l.id === list.id ? { ...l, containsCard: !nextContains } : l)),
      }));
    }
  }

  const icon = (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-4 h-4"
    >
      <path d="M5 3.5h10a.5.5 0 01.5.5v12.5l-5.5-3-5.5 3V4a.5.5 0 01.5-.5z" />
      <path d="M7.25 8h5.5M10 5.25v5.5" />
    </svg>
  );

  return (
    <>
      {variant === "footer" ? (
        <button
          ref={buttonRef}
          type="button"
          onClick={handleTrigger}
          aria-label="Add to list"
          aria-haspopup={isAuthenticated ? "menu" : undefined}
          aria-expanded={isAuthenticated ? open : undefined}
          className="absolute inset-x-0 bottom-0 h-[15%] min-h-[36px] flex items-end justify-between gap-2 px-2 pb-2 bg-gradient-to-b from-transparent to-neutral-800 to-80% text-white text-[12.5px] font-semibold leading-none tabular-nums overflow-hidden text-left hover:to-neutral-700 transition-colors"
        >
          <span className="flex items-center gap-1 min-w-0">
            <span className="truncate rounded-md border border-white/70 bg-black px-0.5 py-0.5">
              {(setCode || setId).toUpperCase()}
            </span>
            <span className="shrink-0 w-3.5 h-3.5">{icon}</span>
          </span>
          <span className="truncate mb-[3px]">
            {setSize > 0 ? `${padNumber(number)}/${setSize}` : padNumber(number)}
          </span>
        </button>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          onClick={handleTrigger}
          aria-label="Add to list"
          aria-haspopup={isAuthenticated ? "menu" : undefined}
          aria-expanded={isAuthenticated ? open : undefined}
          className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full border border-black/10 bg-white dark:bg-surface-2 text-text-primary hover:bg-surface transition-colors"
        >
          {icon}
        </button>
      )}

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
        onCreated={(created) => {
          setState((s) => ({
            ...s,
            lists: [
              {
                id: created.id,
                shortId: created.shortId,
                name: created.name,
                isPublic: created.isPublic,
                itemCount: 1,
                href: created.href,
                previewCards: [{ setId, number }],
                containsCard: true,
              },
              ...s.lists,
            ],
          }));
        }}
      />
    </>
  );
}
