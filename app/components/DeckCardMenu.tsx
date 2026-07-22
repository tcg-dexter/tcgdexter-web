"use client";

import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import EditDeckDialog from "@/app/components/EditDeckDialog";
import { primaryCardImageUrl } from "@/lib/primaryCardImage";

interface DeckCard {
  qty: number;
  name: string;
  number: string;
  setCode: string;
  section: "pokemon" | "trainer" | "energy";
}

interface Props {
  deckId: string;
  deckName: string;
  deckList: string;
  isPublic: boolean;
  isPinned?: boolean;
  cards: DeckCard[];
  coverImageUrl: string | null;
}

/**
 * Ellipsis (⋯) menu for a saved-deck preview card. Mirrors the settings-gear
 * dropdown on the deck profile page (Edit deck / Make public-private / Delete
 * deck) and adds a Copy deck list action. Owner-gated by the caller — only
 * rendered when the viewer can manage the deck.
 *
 * The dropdown and dialogs are portalled to the body so the card's
 * `overflow-hidden` and `hover:shadow` ancestors don't clip them.
 */
export default function DeckCardMenu({
  deckId,
  deckName,
  deckList,
  isPublic: initialIsPublic,
  isPinned = false,
  cards,
  coverImageUrl: initialCoverImageUrl,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(
    null,
  );
  const [editOpen, setEditOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Position the portalled menu against the button's bounding rect, then
  // keep it pinned while open. Recompute on scroll/resize.
  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    function compute() {
      const btn = buttonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      });
    }
    compute();
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
    };
  }, [open]);

  // Close on outside click / Escape. Menu is portalled outside buttonRef,
  // so check both the trigger and the menu element.
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

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(deckList);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* silent — clipboard may be blocked */
    }
  }

  async function toggleVisibility() {
    if (visibilityBusy) return;
    const next = !isPublic;
    setVisibilityBusy(true);
    setIsPublic(next);
    try {
      const res = await fetch(`/api/saved-decks/${deckId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_public: next }),
      });
      if (!res.ok) {
        setIsPublic(!next);
      } else {
        router.refresh();
      }
    } catch {
      setIsPublic(!next);
    } finally {
      setVisibilityBusy(false);
    }
  }

  async function pinDeck() {
    if (pinBusy || isPinned) return;
    setPinBusy(true);
    try {
      const res = await fetch(`/api/saved-decks/${deckId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_pinned: true }),
      });
      if (res.ok) {
        window.scrollTo({ top: 0, behavior: "smooth" });
        router.refresh();
      }
    } finally {
      setPinBusy(false);
    }
  }

  async function handleEditSave({
    name,
    coverUrl,
    deckList: nextDeckList,
  }: {
    name: string;
    coverUrl: string | null;
    deckList: string;
  }) {
    const payload: {
      name?: string;
      cover_image_url?: string | null;
      deck_list?: string;
      analysis?: unknown;
    } = {};
    if (name !== deckName) payload.name = name;
    if (coverUrl !== (initialCoverImageUrl ?? null))
      payload.cover_image_url = coverUrl;

    const deckListChanged =
      nextDeckList.trim().length > 0 && nextDeckList.trim() !== deckList.trim();
    if (deckListChanged) {
      const aRes = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deckList: nextDeckList }),
      });
      const aData = await aRes.json().catch(() => ({}));
      if (!aRes.ok) {
        throw new Error(aData?.error ?? "Failed to analyze the new deck list.");
      }
      payload.deck_list = nextDeckList.trim();
      payload.analysis = aData;
    }

    if (Object.keys(payload).length === 0) return;

    const res = await fetch(`/api/saved-decks/${deckId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.error ?? "Failed to save changes.");
    }
    // Re-fetch the list's server component so the card reflects the update.
    router.refresh();
  }

  async function performDelete() {
    setConfirmingDelete(false);
    setDeleting(true);
    try {
      const res = await fetch(`/api/saved-decks/${deckId}`, {
        method: "DELETE",
      });
      if (res.ok) router.refresh();
    } catch {
      /* silent — user can retry */
    } finally {
      setDeleting(false);
    }
  }

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
        aria-label="Deck actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full text-text-muted hover:text-text-primary hover:bg-black/5 transition-colors"
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
            className="w-44 rounded-xl bg-white dark:bg-surface-elevated border border-black/8 dark:border-white/10 shadow-lg p-1 z-50"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                handleCopy();
              }}
              className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-2 transition-colors"
            >
              {copied ? "Copied!" : "Copy deck list"}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setEditOpen(true);
                setOpen(false);
              }}
              className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-2 transition-colors"
            >
              Edit deck
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                toggleVisibility();
                setOpen(false);
              }}
              disabled={visibilityBusy}
              aria-pressed={isPublic}
              className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-2 transition-colors disabled:opacity-50"
            >
              {isPublic ? "Make private" : "Make public"}
            </button>
            {!isPinned && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  pinDeck();
                  setOpen(false);
                }}
                disabled={pinBusy}
                className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-2 transition-colors disabled:opacity-50"
              >
                Pin this deck
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setConfirmingDelete(true);
                setOpen(false);
              }}
              disabled={deleting}
              className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-accent hover:bg-surface-2 transition-colors disabled:opacity-50"
            >
              Delete deck
            </button>
          </div>,
          document.body,
        )}

      <EditDeckDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        initialName={deckName}
        cards={cards}
        currentCoverUrl={initialCoverImageUrl}
        defaultCoverUrl={primaryCardImageUrl(cards)}
        initialDeckList={deckList}
        onSave={handleEditSave}
      />

      {confirmingDelete && typeof window !== "undefined" &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`delete-deck-title-${deckId}`}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={() => setConfirmingDelete(false)}
          >
            <div
              className="w-full max-w-sm rounded-2xl bg-white/95 dark:bg-surface-elevated backdrop-blur-xl border border-black/5 dark:border-white/10 p-6 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.4)]"
              onClick={(e) => e.stopPropagation()}
            >
              <h2
                id={`delete-deck-title-${deckId}`}
                className="text-base font-semibold text-text-primary"
              >
                Delete this deck?
              </h2>
              <p className="mt-2 text-sm text-text-secondary">
                This cannot be undone.
              </p>
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
    </>
  );
}
