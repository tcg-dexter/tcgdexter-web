"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import NewListDialog from "./NewListDialog";
import type { ListSummary } from "@/lib/lists";

interface Props {
  open: boolean;
  onClose: () => void;
  /** The multi-selected cards, in selection order. */
  cards: Array<{ setId: string; number: string }>;
  /** Fired after every checked list has successfully received every card. */
  onAdded: () => void;
}

/**
 * Bulk "add N selected cards to list(s)" dialog, opened from a catalog/list
 * toolbar's Select mode. Unlike AddToListButton/AddToListOverlay (single
 * card, instant per-list toggle via useListPicker), this stages a set of
 * target lists via checkboxes and only writes on explicit confirm, since
 * "does this list already contain the card" isn't a single boolean once
 * more than one card is selected.
 */
export default function AddSelectionToListDialog({ open, onClose, cards, onAdded }: Props) {
  const [loading, setLoading] = useState(false);
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [hasUsername, setHasUsername] = useState(true);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newListOpen, setNewListOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChecked(new Set());
    setError(null);
    let cancelled = false;
    setLoading(true);
    fetch("/api/lists")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load lists"))))
      .then((data: { lists: ListSummary[]; hasUsername: boolean }) => {
        if (cancelled) return;
        setLists(data.lists);
        setHasUsername(data.hasUsername);
      })
      .catch(() => {
        if (cancelled) return;
        setLists([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function toggleList(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function addCardsToList(listId: string) {
    const results = await Promise.all(
      cards.map((c) =>
        fetch(`/api/lists/${listId}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ setId: c.setId, number: c.number }),
        }),
      ),
    );
    if (results.some((r) => !r.ok)) throw new Error("Some cards failed to add.");
  }

  async function handleAdd() {
    if (cards.length === 0 || checked.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      await Promise.all(Array.from(checked).map((listId) => addCardsToList(listId)));
      onAdded();
      onClose();
    } catch {
      setError("Some cards couldn't be added — please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-selection-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white/95 dark:bg-surface-elevated backdrop-blur-xl border border-black/5 dark:border-white/10 p-5 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.4)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="add-selection-title" className="text-base font-semibold text-text-primary">
          Add {cards.length} {cards.length === 1 ? "card" : "cards"} to list:
        </h2>

        <div className="mt-3 max-h-64 overflow-y-auto space-y-1">
          {loading ? (
            <p className="text-sm text-text-secondary px-1 py-2">Loading…</p>
          ) : !hasUsername ? (
            <p className="text-sm text-text-secondary px-1 py-2">
              <Link href="/welcome" className="font-semibold text-accent hover:underline">
                Set a username
              </Link>{" "}
              to start creating lists.
            </p>
          ) : (
            <>
              {lists.length === 0 && (
                <p className="text-sm text-text-secondary px-1 py-2">No lists yet.</p>
              )}
              {lists.map((l) => (
                <label
                  key={l.id}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-2 transition-colors cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={checked.has(l.id)}
                    onChange={() => toggleList(l.id)}
                    className="w-4 h-4 rounded border-black/20 accent-accent"
                  />
                  <span className="truncate flex-1">{l.name}</span>
                </label>
              ))}
              <button
                type="button"
                onClick={() => setNewListOpen(true)}
                className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-accent hover:bg-surface-2 transition-colors"
              >
                + New list
              </button>
            </>
          )}
        </div>

        {error && (
          <p className="mt-2 text-xs text-accent" role="alert">
            {error}
          </p>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex items-center justify-center rounded-full border border-black/10 bg-white dark:bg-surface-2 px-4 py-1.5 text-xs font-semibold text-text-secondary hover:bg-black/5 transition disabled:opacity-50 touch-manipulation"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAdd}
            disabled={busy || cards.length === 0 || checked.size === 0}
            className="inline-flex items-center justify-center rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-white hover:bg-accent-light transition disabled:opacity-50 touch-manipulation"
          >
            {busy ? "Adding…" : "Add to list"}
          </button>
        </div>
      </div>

      <NewListDialog
        open={newListOpen}
        onClose={() => setNewListOpen(false)}
        onCreated={async (created) => {
          setNewListOpen(false);
          setBusy(true);
          setError(null);
          try {
            await addCardsToList(created.id);
            onAdded();
            onClose();
          } catch {
            setError("List created, but adding cards failed — try again.");
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>,
    document.body,
  );
}
