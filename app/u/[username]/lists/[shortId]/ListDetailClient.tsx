"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import BackButton from "@/app/components/ui/BackButton";
import PillSelect from "@/app/components/ui/PillSelect";
import GridListToggle from "@/app/components/ui/GridListToggle";
import InventoryProvider from "@/app/cards/InventoryContext";
import { GridView, ListView } from "@/app/cards/CardCollectionView";
import type { CardIndexEntry } from "@/lib/cardsIndex";
import { sortCardEntries, type SortKey, type SortDir } from "@/lib/cardSearch";

interface Props {
  isOwner: boolean;
  username: string;
  listId: string;
  initialName: string;
  initialIsPublic: boolean;
  cards: CardIndexEntry[];
  canonicalShareUrl: string;
}

export default function ListDetailClient({
  isOwner,
  username,
  listId,
  initialName,
  initialIsPublic,
  cards,
  canonicalShareUrl,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [sort, setSort] = useState<SortKey>("released");
  const [dir, setDir] = useState<SortDir>("desc");
  const [view, setView] = useState<"grid" | "list">("grid");

  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(initialName);
  const [renameBusy, setRenameBusy] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPos(null);
      return;
    }
    function compute() {
      const btn = menuButtonRef.current;
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
  }, [menuOpen]);

  const sortedCards = useMemo(() => sortCardEntries(cards, sort, dir), [cards, sort, dir]);

  async function saveRename() {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === name) {
      setRenaming(false);
      setNameDraft(name);
      return;
    }
    setRenameBusy(true);
    const prev = name;
    setName(trimmed);
    try {
      const res = await fetch(`/api/lists/${listId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) setName(prev);
    } catch {
      setName(prev);
    } finally {
      setRenameBusy(false);
      setRenaming(false);
    }
  }

  async function toggleVisibility() {
    if (visibilityBusy) return;
    const next = !isPublic;
    setVisibilityBusy(true);
    setIsPublic(next);
    try {
      const res = await fetch(`/api/lists/${listId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_public: next }),
      });
      if (!res.ok) setIsPublic(!next);
    } catch {
      setIsPublic(!next);
    } finally {
      setVisibilityBusy(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(canonicalShareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* silent — clipboard may be blocked */
    }
  }

  async function performDelete() {
    setConfirmingDelete(false);
    setDeleting(true);
    try {
      const res = await fetch(`/api/lists/${listId}`, { method: "DELETE" });
      if (res.ok) router.push(`/u/${username}`);
    } catch {
      /* silent — user can retry */
    } finally {
      setDeleting(false);
    }
  }

  return (
    <InventoryProvider>
      <main className="mx-auto max-w-[1400px] px-4 sm:px-6 pt-[calc(env(safe-area-inset-top)_+_1.68rem)] md:pt-[calc(env(safe-area-inset-top)_+_3rem)] xl:pt-[calc(env(safe-area-inset-top)_+_0.75rem)] pb-24">
        <div className="hidden xl:block mb-6">
          <BackButton href={`/u/${username}`} ariaLabel={`Back to @${username}'s lists`} />
        </div>

        <div className="mb-6 flex items-end justify-between gap-3">
          {renaming ? (
            <input
              type="text"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={saveRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveRename();
                } else if (e.key === "Escape") {
                  setNameDraft(name);
                  setRenaming(false);
                }
              }}
              disabled={renameBusy}
              autoFocus
              className="min-w-0 flex-1 text-3xl md:text-4xl font-semibold tracking-tight text-text-primary bg-transparent border-b-2 border-accent focus:outline-none disabled:opacity-50"
            />
          ) : (
            <h2 className="min-w-0 flex-1 truncate text-3xl md:text-4xl font-semibold tracking-tight text-text-primary">
              {name}
            </h2>
          )}

          {isOwner && !renaming && (
            <button
              type="button"
              onClick={() => {
                setNameDraft(name);
                setRenaming(true);
              }}
              aria-label="Rename list"
              className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full text-text-muted hover:text-text-primary hover:bg-black/5 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z"
                />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12v6.75a2.25 2.25 0 01-2.25 2.25H5.25a2.25 2.25 0 01-2.25-2.25V6.75a2.25 2.25 0 012.25-2.25H12" />
              </svg>
            </button>
          )}

          {isOwner && (
            <div className="shrink-0">
              <button
                ref={menuButtonRef}
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                aria-label="List actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="inline-flex items-center justify-center h-[38px] w-[38px] rounded-full border border-black/10 bg-white dark:bg-surface-2 text-text-primary hover:bg-surface transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <circle cx="5" cy="12" r="1.75" />
                  <circle cx="12" cy="12" r="1.75" />
                  <circle cx="19" cy="12" r="1.75" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {!isOwner && (
          <p className="-mt-4 mb-6 text-sm text-text-secondary">
            {cards.length} {cards.length === 1 ? "card" : "cards"}
          </p>
        )}

        {isOwner &&
          menuOpen &&
          menuPos !== null &&
          typeof window !== "undefined" &&
          createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={{ position: "fixed", top: menuPos.top, right: menuPos.right }}
              className="w-48 rounded-xl bg-white dark:bg-surface-elevated border border-black/8 dark:border-white/10 shadow-lg p-1 z-50"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  toggleVisibility();
                  setMenuOpen(false);
                }}
                disabled={visibilityBusy}
                aria-pressed={isPublic}
                className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-2 transition-colors disabled:opacity-50"
              >
                {isPublic ? "Make private" : "Make public"}
              </button>
              {isPublic && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    handleCopy();
                  }}
                  className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-2 transition-colors"
                >
                  {copied ? "Copied!" : "Copy list link"}
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setConfirmingDelete(true);
                  setMenuOpen(false);
                }}
                disabled={deleting}
                className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-accent hover:bg-surface-2 transition-colors disabled:opacity-50"
              >
                Delete list
              </button>
            </div>,
            document.body,
          )}

        {confirmingDelete &&
          typeof window !== "undefined" &&
          createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-list-title"
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
              onClick={() => setConfirmingDelete(false)}
            >
              <div
                className="w-full max-w-sm rounded-2xl bg-white/95 dark:bg-surface-elevated backdrop-blur-xl border border-black/5 dark:border-white/10 p-6 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.4)]"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 id="delete-list-title" className="text-base font-semibold text-text-primary">
                  Delete this list?
                </h2>
                <p className="mt-2 text-sm text-text-secondary">This cannot be undone.</p>
                <div className="mt-5 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    className="inline-flex items-center justify-center rounded-full border border-black/10 bg-white dark:bg-surface-2 px-4 py-1.5 text-xs font-semibold text-text-secondary hover:bg-black/5 transition touch-manipulation"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={performDelete}
                    disabled={deleting}
                    className="inline-flex items-center justify-center rounded-full bg-black dark:bg-white px-4 py-1.5 text-xs font-semibold text-white dark:text-black disabled:opacity-50 hover:opacity-80 transition-opacity touch-manipulation"
                  >
                    {deleting ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )}

        {cards.length === 0 ? (
          <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white dark:bg-surface-elevated p-6 text-center">
            <p className="text-sm text-text-secondary">
              No cards in this list yet. Add cards from any card&apos;s detail page.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-end gap-2">
              <PillSelect
                value={`${sort}:${dir}`}
                onChange={(e) => {
                  const [s, d] = e.target.value.split(":") as [SortKey, SortDir];
                  setSort(s);
                  setDir(d);
                }}
              >
                <option value="released:desc">Set (New to Old)</option>
                <option value="released:asc">Set (Old to New)</option>
                <option value="name:asc">Card Name (A–Z)</option>
                <option value="name:desc">Card Name (Z–A)</option>
                <option value="hp:desc">Hit Points (High to Low)</option>
                <option value="hp:asc">Hit Points (Low to High)</option>
                <option value="price:desc">Market Price (High to Low)</option>
                <option value="price:asc">Market Price (Low to High)</option>
                <option value="rarity:desc">Rarity ↓</option>
                <option value="rarity:asc">Rarity ↑</option>
              </PillSelect>
              <GridListToggle value={view} onChange={setView} />
            </div>

            {view === "grid" ? <GridView cards={sortedCards} /> : <ListView cards={sortedCards} />}
          </>
        )}
      </main>
    </InventoryProvider>
  );
}
