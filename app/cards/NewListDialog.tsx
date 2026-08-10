"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface CreatedList {
  id: string;
  shortId: string;
  name: string;
  isPublic: boolean;
  href: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (list: CreatedList) => void;
  /** When set, the new list's first card is added as part of creation. */
  cardToAdd?: { setId: string; number: string };
}

/**
 * Create-a-list modal. A single name + visibility step — unlike
 * NewDeckDialog there's no deck-list parse step or cover image, so this
 * mirrors only that dialog's step-2 markup. Reused by both the Lists
 * overview panel's "+ New List" button and the Add-to-list picker's
 * inline "+ New list" row (via `cardToAdd`).
 */
export default function NewListDialog({ open, onClose, onCreated, cardToAdd }: Props) {
  const [name, setName] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setIsPublic(false);
      setBusy(false);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open || typeof document === "undefined") return null;

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give your list a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, isPublic, cardToAdd }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create list.");
        return;
      }
      onCreated(data as CreatedList);
      onClose();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-list-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={() => !busy && onClose()}
    >
      <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="relative group">
          <div className="absolute -inset-px rounded-2xl bg-gradient-brand opacity-40 group-focus-within:opacity-70 blur-xl transition-opacity" />
          <div className="relative rounded-2xl bg-white/95 dark:bg-surface-elevated backdrop-blur-xl border border-black/5 dark:border-white/10 shadow-brand-lg">
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h2 id="new-list-title" className="text-lg font-semibold tracking-tight">
                <span className="bg-gradient-brand bg-clip-text text-transparent">New list</span>
              </h2>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                aria-label="Close"
                className="rounded-full p-1.5 text-text-muted hover:bg-black/5 hover:text-text-primary transition disabled:opacity-50"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-5 pb-5">
              <label
                htmlFor="new-list-name"
                className="block text-xs font-semibold uppercase tracking-wider text-text-muted mb-1.5"
              >
                List name
              </label>
              <input
                id="new-list-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSave();
                  }
                }}
                disabled={busy}
                autoFocus
                placeholder="Want list, trade bait, next deck…"
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 disabled:opacity-50 [font-size:16px] sm:text-sm"
              />

              <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
                Visibility
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsPublic(false)}
                  disabled={busy}
                  aria-pressed={!isPublic}
                  className={`flex-1 rounded-lg border py-2 text-xs font-semibold transition disabled:opacity-50 ${
                    !isPublic
                      ? "border-accent bg-accent/5 text-accent"
                      : "border-black/10 bg-white dark:bg-surface-2 text-text-secondary hover:bg-black/[0.02]"
                  }`}
                >
                  Private
                </button>
                <button
                  type="button"
                  onClick={() => setIsPublic(true)}
                  disabled={busy}
                  aria-pressed={isPublic}
                  className={`flex-1 rounded-lg border py-2 text-xs font-semibold transition disabled:opacity-50 ${
                    isPublic
                      ? "border-accent bg-accent/5 text-accent"
                      : "border-black/10 bg-white dark:bg-surface-2 text-text-secondary hover:bg-black/[0.02]"
                  }`}
                >
                  Public
                </button>
              </div>
              {isPublic && (
                <p className="mt-1.5 text-[11px] text-text-secondary">
                  Visible on your public profile and shareable via link.
                </p>
              )}

              {error && (
                <p className="mt-3 text-xs text-accent" role="alert">
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
                  onClick={handleSave}
                  disabled={busy || name.trim().length === 0}
                  className="inline-flex items-center justify-center rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-white hover:bg-accent-light transition disabled:opacity-50 touch-manipulation"
                >
                  {busy ? "Creating…" : "Create list"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
