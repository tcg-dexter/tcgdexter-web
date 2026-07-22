"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import DeckProfileView, {
  type AnalysisResult,
} from "@/app/components/DeckProfileView";
import QRCodeButton from "@/app/components/QRCodeButton";
import { useTheme } from "@/app/components/ThemeProvider";
import { WLCircles } from "@/app/components/DeckPostCard";
import MatchLog from "./MatchLog";
import DeckNotes from "./DeckNotes";

interface Match {
  id: string;
  result: "win" | "loss" | "draw";
  opponent_name: string | null;
  opponent_archetype: string | null;
  opponent_deck_list: string | null;
  notes: string | null;
  played_at: string;
}

interface Props {
  savedDeckId: string;
  deckList: string;
  analysis: AnalysisResult;
  initialMatches: Match[];
  initialNotes: string;
  pageTitle: string;
  profiledAt: string;
  initialIsPublic: boolean;
  /**
   * Pre-built canonical /u/[username]/[deckId] URL. Only used when the deck
   * is currently public; null when the owner hasn't set a username yet.
   */
  canonicalShareUrl: string | null;
}

export default function MyDeckClient({
  savedDeckId,
  deckList,
  analysis,
  initialMatches,
  initialNotes,
  pageTitle,
  profiledAt,
  initialIsPublic,
  canonicalShareUrl,
}: Props) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const [logOpen, setLogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const actionRowRef = useRef<HTMLDivElement>(null);

  // Bring the action row to the top of the viewport when the match log
  // form opens. Closing (e.g. after a save) intentionally doesn't scroll.
  useEffect(() => {
    if (logOpen) {
      actionRowRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [logOpen]);

  // Public/private state
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [visibilityBusy, setVisibilityBusy] = useState(false);

  // Rename state
  const [deckName, setDeckName] = useState(pageTitle);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(pageTitle);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  async function toggleVisibility() {
    if (visibilityBusy) return;
    const next = !isPublic;
    setVisibilityBusy(true);
    setIsPublic(next);
    try {
      const res = await fetch(`/api/saved-decks/${savedDeckId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_public: next }),
      });
      if (!res.ok) {
        setIsPublic(!next);
      }
    } catch {
      setIsPublic(!next);
    } finally {
      setVisibilityBusy(false);
    }
  }

  async function handleRename() {
    const trimmed = titleInput.trim();
    if (!trimmed || trimmed === deckName) {
      setEditingTitle(false);
      setTitleInput(deckName);
      return;
    }
    setRenameBusy(true);
    setRenameError(null);
    try {
      const res = await fetch(`/api/saved-decks/${savedDeckId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (res.ok) {
        setDeckName(trimmed);
        setEditingTitle(false);
      } else {
        setRenameError(data.error ?? "Failed to rename.");
      }
    } catch {
      setRenameError("Network error.");
    } finally {
      setRenameBusy(false);
    }
  }

  // Position the portalled menu against the gear button's bounding rect,
  // then keep it pinned while open. Recompute on scroll/resize so it
  // doesn't drift off-anchor.
  useLayoutEffect(() => {
    if (!settingsOpen) {
      setMenuPos(null);
      return;
    }
    function compute() {
      const btn = settingsButtonRef.current;
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
  }, [settingsOpen]);

  // Close the settings menu on outside click / Escape. The menu is
  // portalled to the body — outside settingsRef — so we check both the
  // gear button's wrapper and the menu element itself.
  useEffect(() => {
    if (!settingsOpen) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (
        !settingsRef.current?.contains(target) &&
        !settingsMenuRef.current?.contains(target)
      ) {
        setSettingsOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setSettingsOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [settingsOpen]);

  async function performDelete() {
    setConfirmingDelete(false);
    setDeleting(true);
    try {
      const res = await fetch(`/api/saved-decks/${savedDeckId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        router.push("/my-decks");
      }
    } catch {
      // silent — user can retry
    } finally {
      setDeleting(false);
    }
  }

  // W-L record, displayed inline next to the deck name (where the rename
  // icon used to sit) — moved here from the Match History header.
  const wins = initialMatches.filter((m) => m.result === "win").length;
  const losses = initialMatches.filter((m) => m.result === "loss").length;
  const draws = initialMatches.filter((m) => m.result === "draw").length;

  // Title row action — right-anchored W-L record. Rename now lives in the
  // settings menu (gear button in the action row).
  const titleAction = !editingTitle ? (
    <div className="ml-auto">
      <WLCircles wl={{ w: wins, l: losses, d: draws }} />
    </div>
  ) : null;

  // Rename form shown in the subtitle slot when editing.
  // Pass `false` when not editing so DeckProfileView's "Created on" fallback is suppressed.
  const subtitle: React.ReactNode = editingTitle ? (
    <div className="flex flex-col gap-1.5 mt-1">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={titleInput}
          onChange={(e) => setTitleInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleRename()}
          autoFocus
          disabled={renameBusy}
          className="flex-1 min-w-0 rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 [font-size:16px] sm:text-sm"
        />
        <button
          onClick={handleRename}
          disabled={renameBusy}
          className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-light disabled:opacity-50"
        >
          {renameBusy ? "…" : "Save"}
        </button>
        <button
          onClick={() => { setEditingTitle(false); setTitleInput(deckName); setRenameError(null); }}
          disabled={renameBusy}
          className="rounded-full border border-border bg-bg px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-surface-2 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {renameError && <p className="text-xs text-accent">{renameError}</p>}
    </div>
  ) : false;

  // Surface the canonical share URL only when the deck is currently public.
  // Private decks fall back to the /api/deck-share snapshot path so the
  // owner can still QR/copy something without flipping public.
  const shareUrl = isPublic && canonicalShareUrl ? canonicalShareUrl : undefined;

  return (
    <DeckProfileView
      variant="saved"
      deckList={deckList}
      analysis={analysis}
      profiledAt={profiledAt}
      pageTitle={deckName}
      titleAction={titleAction}
      subtitle={subtitle}
      shareUrl={shareUrl}
      dimBelow={logOpen}
      postStatsSlot={
        <>
          {/* Action buttons */}
          <div
            ref={actionRowRef}
            className={`relative flex items-center transition-all duration-300 ${
              logOpen ? "gap-0" : "gap-3"
            }`}
          >
            <button
              onClick={() => setLogOpen((o) => !o)}
              className={`flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 rounded-full border border-transparent px-[1px] py-2 text-sm font-semibold transition-all ${
                logOpen ? (resolvedTheme === "dark" ? "text-black" : "text-white") : "text-text-secondary"
              }`}
              style={{
                backgroundImage: logOpen
                  ? resolvedTheme === "dark"
                    ? "linear-gradient(white, white), linear-gradient(white, white)"
                    : "linear-gradient(black, black), linear-gradient(black, black)"
                  : "linear-gradient(var(--bg), var(--bg)), var(--gradient-brand)",
                backgroundOrigin: "border-box",
                backgroundClip: "padding-box, border-box",
              }}
            >
              Log Match
            </button>
            <div
              className={`flex items-center gap-3 overflow-hidden transition-all duration-300 ${
                logOpen ? "opacity-0 pointer-events-none" : "opacity-100"
              }`}
              style={{ flexGrow: logOpen ? 0 : 2, flexBasis: "0%" }}
              aria-hidden={logOpen}
            >
              <QRCodeButton
                shareUrl={shareUrl}
                deckList={deckList}
                analysis={analysis}
                className="flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 rounded-full border border-transparent bg-gradient-brand-reverse bg-origin-border px-[1px] py-2 text-sm font-semibold text-white transition disabled:opacity-50"
              />
              {/* Settings — icon-only, same visual weight as QR button.
                  Dropdown menu lives outside this wrapper (below) so the
                  ancestor `overflow-hidden` doesn't clip it. */}
              <div ref={settingsRef} className="flex-1 min-w-0">
                <button
                  ref={settingsButtonRef}
                  type="button"
                  onClick={() => setSettingsOpen((o) => !o)}
                  aria-label="Deck settings"
                  aria-haspopup="menu"
                  aria-expanded={settingsOpen}
                  className="w-full inline-flex items-center justify-center rounded-full bg-black dark:bg-white border border-transparent px-[1px] py-[11px] text-white dark:text-black disabled:opacity-50 transition-opacity hover:opacity-80 touch-manipulation"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.75}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.076.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.004.827c-.292.24-.437.613-.43.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>
          {settingsOpen && !logOpen && menuPos !== null && typeof window !== "undefined" &&
            createPortal(
              <div
                ref={settingsMenuRef}
                role="menu"
                style={{ position: "fixed", top: menuPos.top, right: menuPos.right }}
                className="w-44 rounded-xl bg-white dark:bg-surface-elevated border border-black/8 dark:border-white/10 shadow-lg p-1 z-50"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setEditingTitle(true);
                    setTitleInput(deckName);
                    setSettingsOpen(false);
                  }}
                  className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-2 transition-colors"
                >
                  Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    toggleVisibility();
                    setSettingsOpen(false);
                  }}
                  disabled={visibilityBusy}
                  aria-pressed={isPublic}
                  className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-2 transition-colors disabled:opacity-50"
                >
                  {isPublic ? "Make private" : "Make public"}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setConfirmingDelete(true);
                    setSettingsOpen(false);
                  }}
                  disabled={deleting}
                  className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-accent hover:bg-surface-2 transition-colors disabled:opacity-50"
                >
                  Delete deck
                </button>
              </div>,
              document.body
            )}

          {(initialMatches.length > 0 || logOpen) && (
            <div className="mt-2">
              <MatchLog
                savedDeckId={savedDeckId}
                initialMatches={initialMatches}
                open={logOpen}
                onOpenChange={setLogOpen}
              />
            </div>
          )}

          {confirmingDelete && (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-deck-title"
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
              onClick={() => setConfirmingDelete(false)}
            >
              <div
                className="w-full max-w-sm rounded-2xl bg-white/95 dark:bg-surface-elevated backdrop-blur-xl border border-black/5 dark:border-white/10 p-6 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.4)]"
                onClick={(e) => e.stopPropagation()}
              >
                <h2
                  id="delete-deck-title"
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
            </div>
          )}
        </>
      }
      topSlot={
        <DeckNotes savedDeckId={savedDeckId} initialNotes={initialNotes} />
      }
      footerCta={
        <Link
          href="/my-decks"
          className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-bg px-6 py-3 text-sm font-semibold text-text-primary transition-all hover:bg-surface-2"
        >
          Back to My Decks
        </Link>
      }
    />
  );
}
