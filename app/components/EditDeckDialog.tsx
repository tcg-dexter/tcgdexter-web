"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { cardImageUrlFor } from "@/lib/primaryCardImage";

interface DeckCard {
  qty: number;
  name: string;
  number: string;
  setCode: string;
  section: "pokemon" | "trainer" | "energy";
}

interface PickableCard {
  key: string;
  name: string;
  number: string;
  setCode: string;
  section: "pokemon" | "trainer" | "energy";
  imageUrl: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  initialName: string;
  cards: DeckCard[];
  /** Currently-persisted override URL (null = auto-pick). */
  currentCoverUrl: string | null;
  /** Resolved auto-pick URL, shown as the "Auto-pick" preview. */
  defaultCoverUrl: string | null;
  /** Current deck list, shown in the editable textarea. */
  initialDeckList: string;
  /** Persist all changes in one go. Throws on failure. */
  onSave: (next: {
    name: string;
    coverUrl: string | null;
    deckList: string;
  }) => Promise<void>;
}

const SECTION_LABEL: Record<DeckCard["section"], string> = {
  pokemon: "Pokémon",
  trainer: "Trainer",
  energy: "Energy",
};
const SECTION_ORDER: DeckCard["section"][] = ["pokemon", "trainer", "energy"];

export default function EditDeckDialog({
  open,
  onClose,
  initialName,
  cards,
  currentCoverUrl,
  defaultCoverUrl,
  initialDeckList,
  onSave,
}: Props) {
  const [nameInput, setNameInput] = useState(initialName);
  const [pendingCoverUrl, setPendingCoverUrl] = useState<string | null>(currentCoverUrl);
  const [deckListInput, setDeckListInput] = useState(initialDeckList);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed local state whenever the dialog re-opens so a Cancel followed
  // by a re-open shows the persisted values, not the previous pending edits.
  useEffect(() => {
    if (open) {
      setNameInput(initialName);
      setPendingCoverUrl(currentCoverUrl);
      setDeckListInput(initialDeckList);
      setError(null);
    }
  }, [open, initialName, currentCoverUrl, initialDeckList]);

  const grouped = useMemo(() => {
    const seen = new Map<string, PickableCard>();
    for (const card of cards) {
      const key = `${card.name}|${card.setCode}|${card.number}`;
      if (seen.has(key)) continue;
      const imageUrl = cardImageUrlFor(card);
      if (!imageUrl) continue;
      seen.set(key, {
        key,
        name: card.name,
        number: card.number,
        setCode: card.setCode,
        section: card.section,
        imageUrl,
      });
    }
    const out: Record<DeckCard["section"], PickableCard[]> = {
      pokemon: [],
      trainer: [],
      energy: [],
    };
    seen.forEach((c) => out[c.section].push(c));
    return out;
  }, [cards]);

  if (!open) return null;

  const trimmedName = nameInput.trim();
  const trimmedDeckList = deckListInput.trim();
  const nameChanged = trimmedName.length > 0 && trimmedName !== initialName;
  const coverChanged = pendingCoverUrl !== currentCoverUrl;
  const deckListChanged =
    trimmedDeckList.length > 0 && trimmedDeckList !== initialDeckList.trim();
  const canSave =
    !busy &&
    trimmedName.length > 0 &&
    (nameChanged || coverChanged || deckListChanged);

  async function handleSave() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({
        name: trimmedName,
        coverUrl: pendingCoverUrl,
        deckList: trimmedDeckList,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save changes.");
    } finally {
      setBusy(false);
    }
  }

  // Render through a portal to escape any ancestor that creates a
  // containing block for fixed children (e.g. a card with backdrop-blur).
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-deck-title"
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
            id="edit-deck-title"
            className="text-base font-semibold text-text-primary"
          >
            Edit deck
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

        {/* Name */}
        <div className="px-5 pt-4 pb-3 border-b border-black/5">
          <label
            htmlFor="edit-deck-name"
            className="block text-xs font-semibold uppercase tracking-wider text-text-muted mb-1.5"
          >
            Deck name
          </label>
          <input
            id="edit-deck-name"
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSave();
              }
            }}
            disabled={busy}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 disabled:opacity-50 [font-size:16px] sm:text-sm"
          />
        </div>

        {/* Deck list */}
        <div className="px-5 pt-4 pb-3 border-b border-black/5">
          <label
            htmlFor="edit-deck-list"
            className="block text-xs font-semibold uppercase tracking-wider text-text-muted mb-1.5"
          >
            Deck list
          </label>
          <textarea
            id="edit-deck-list"
            value={deckListInput}
            onChange={(e) => setDeckListInput(e.target.value)}
            disabled={busy}
            rows={5}
            spellCheck={false}
            placeholder="Paste a deck list to replace the current one…"
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-xs font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 resize-y disabled:opacity-50 [font-size:16px] sm:text-xs"
          />
          {deckListChanged && (
            <p className="mt-1.5 text-[11px] text-text-secondary">
              Saving re-analyzes the deck and refreshes the profile. Pick a new
              cover below after it updates if needed.
            </p>
          )}
        </div>

        {/* Cover image */}
        <div className="px-5 pt-4 pb-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
            Cover image
          </p>
          <button
            type="button"
            onClick={() => setPendingCoverUrl(null)}
            disabled={busy}
            aria-pressed={pendingCoverUrl === null}
            className={`w-full flex items-center gap-3 rounded-xl border p-2.5 text-left transition disabled:opacity-50 ${
              pendingCoverUrl === null
                ? "border-accent bg-accent/5"
                : "border-black/10 bg-white hover:bg-black/[0.02]"
            }`}
          >
            <div
              className="shrink-0 rounded-md overflow-hidden border border-black/[0.07] bg-[var(--surface)] flex items-center justify-center"
              style={{ width: 44, height: 60 }}
            >
              {defaultCoverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={defaultCoverUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-[8px] text-text-muted leading-tight px-1 text-center">
                  Auto
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text-primary">
                Auto-pick (default)
              </p>
              <p className="text-xs text-text-secondary">
                Highest-stage Pokémon, most copies.
              </p>
            </div>
            {pendingCoverUrl === null && (
              <span className="text-xs font-semibold text-accent">Selected</span>
            )}
          </button>
        </div>

        {/* Card grid */}
        <div className="flex-1 overflow-y-auto px-5 pt-2 pb-4">
          {SECTION_ORDER.every((s) => grouped[s].length === 0) ? (
            <p className="text-sm text-text-secondary text-center py-8">
              No matchable cards in this deck list.
            </p>
          ) : (
            SECTION_ORDER.filter((s) => grouped[s].length > 0).map((section) => (
              <div key={section} className="mb-5 last:mb-0">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
                  {SECTION_LABEL[section]}
                </h3>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                  {grouped[section].map((card) => {
                    const selected = pendingCoverUrl === card.imageUrl;
                    return (
                      <button
                        key={card.key}
                        type="button"
                        onClick={() => setPendingCoverUrl(card.imageUrl)}
                        disabled={busy}
                        aria-pressed={selected}
                        className={`group relative rounded-lg overflow-hidden border-2 transition disabled:opacity-50 ${
                          selected
                            ? "border-accent shadow-md"
                            : "border-transparent hover:border-black/20"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={card.imageUrl}
                          alt={card.name}
                          loading="lazy"
                          className="w-full aspect-[5/7] object-cover bg-[var(--surface)]"
                        />
                        <div className="px-1.5 py-1 bg-white">
                          <p className="text-[11px] font-medium text-text-primary truncate">
                            {card.name}
                          </p>
                          <p className="text-[10px] text-text-muted truncate">
                            {card.setCode} {card.number}
                          </p>
                        </div>
                        {selected && (
                          <span className="absolute top-1.5 right-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-accent text-white shadow">
                            <svg
                              className="w-3 h-3"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={3}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-black/5 flex items-center justify-end gap-2">
          {error && (
            <p className="mr-auto text-xs text-accent">{error}</p>
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
            onClick={handleSave}
            disabled={!canSave}
            className="inline-flex items-center justify-center rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-white hover:bg-accent-light transition disabled:opacity-50 touch-manipulation"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
