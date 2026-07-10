"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * The "commit" dialog — the explicit way to add a new version to a deck.
 * Pre-filled with the current list; posts to the versions API, which
 * analyzes server-side and skips no-op saves (unchanged card multiset).
 * Styled to match EditDeckDialog.
 */

interface ArchetypeSuggestion {
  archetypeId: string | null;
  archetypeName: string;
  current: { archetypeId: string | null; archetypeName: string | null };
}

interface Props {
  open: boolean;
  onClose: () => void;
  deckId: string;
  /** The deck's current (latest) list, used to seed the textarea. */
  initialDeckList: string;
  /** Fired after a version is committed; carries the drift suggestion when
   *  detection moved. The parent refreshes the page. */
  onCommitted: (suggestion: ArchetypeSuggestion | null) => void;
}

export default function NewVersionDialog({
  open,
  onClose,
  deckId,
  initialDeckList,
  onCommitted,
}: Props) {
  const [deckListInput, setDeckListInput] = useState(initialDeckList);
  const [versionName, setVersionName] = useState("");
  const [changelog, setChangelog] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noopNotice, setNoopNotice] = useState(false);

  // Re-seed whenever the dialog re-opens so a Cancel followed by a re-open
  // shows the persisted list, not previous pending edits.
  useEffect(() => {
    if (open) {
      setDeckListInput(initialDeckList);
      setVersionName("");
      setChangelog("");
      setError(null);
      setNoopNotice(false);
    }
  }, [open, initialDeckList]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const trimmedList = deckListInput.trim();
  const canCommit = !busy && trimmedList.length > 0;

  async function handleCommit() {
    if (!canCommit) return;
    setBusy(true);
    setError(null);
    setNoopNotice(false);
    try {
      const res = await fetch(`/api/saved-decks/${deckId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deck_list: trimmedList,
          name: versionName.trim() || undefined,
          changelog: changelog.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to commit version.");
      }
      if (data.created === false) {
        // No-op guard: same card multiset as the latest version.
        setNoopNotice(true);
        return;
      }
      onCommitted(
        (data.archetypeSuggestion as ArchetypeSuggestion | undefined) ?? null,
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to commit version.");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-version-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl bg-white/95 backdrop-blur-xl border border-black/5 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.4)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-black/5">
          <h2
            id="new-version-title"
            className="text-base font-semibold text-text-primary"
          >
            New version
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="rounded-full p-1.5 text-text-muted hover:bg-black/5 hover:text-text-primary transition disabled:opacity-50"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.75}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 pt-4 pb-4">
          <label
            htmlFor="new-version-list"
            className="block text-xs font-semibold uppercase tracking-wider text-text-muted mb-1.5"
          >
            Deck list
          </label>
          <textarea
            id="new-version-list"
            value={deckListInput}
            onChange={(e) => {
              setDeckListInput(e.target.value);
              setNoopNotice(false);
            }}
            disabled={busy}
            rows={10}
            spellCheck={false}
            placeholder="Paste the new deck list…"
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-xs font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 resize-y disabled:opacity-50 [font-size:16px] sm:text-xs"
          />
          <p className="mt-1.5 text-[11px] text-text-secondary">
            Committing adds this list to the deck&apos;s history as the new
            latest version. Earlier versions stay browsable — nothing is
            overwritten.
          </p>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="new-version-name"
                className="block text-xs font-semibold uppercase tracking-wider text-text-muted mb-1.5"
              >
                Version name{" "}
                <span className="normal-case font-medium tracking-normal">(optional)</span>
              </label>
              <input
                id="new-version-name"
                type="text"
                value={versionName}
                onChange={(e) => setVersionName(e.target.value)}
                disabled={busy}
                maxLength={60}
                placeholder="e.g. Worlds list"
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 disabled:opacity-50 [font-size:16px] sm:text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="new-version-changelog"
                className="block text-xs font-semibold uppercase tracking-wider text-text-muted mb-1.5"
              >
                What changed?{" "}
                <span className="normal-case font-medium tracking-normal">(optional)</span>
              </label>
              <input
                id="new-version-changelog"
                type="text"
                value={changelog}
                onChange={(e) => setChangelog(e.target.value)}
                disabled={busy}
                maxLength={200}
                placeholder="e.g. −2 Iono, +2 Judge"
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 disabled:opacity-50 [font-size:16px] sm:text-sm"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-black/5 flex items-center justify-end gap-2">
          {error && <p className="mr-auto text-xs text-accent">{error}</p>}
          {!error && noopNotice && (
            <p className="mr-auto text-xs text-text-secondary">
              No card changes — nothing to commit.
            </p>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex items-center justify-center rounded-full border border-black/10 bg-white px-4 py-1.5 text-xs font-semibold text-text-secondary hover:bg-black/5 transition disabled:opacity-50 touch-manipulation"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCommit}
            disabled={!canCommit}
            className="inline-flex items-center justify-center rounded-full bg-black px-4 py-1.5 text-xs font-semibold text-white hover:opacity-80 transition-opacity disabled:opacity-50 touch-manipulation"
          >
            {busy ? "Committing…" : "Commit version"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
