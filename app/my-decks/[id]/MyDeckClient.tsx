"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import DeckProfileView, {
  type AnalysisResult,
} from "@/app/components/DeckProfileView";
import QRCodeButton from "@/app/components/QRCodeButton";
import DeckListCard from "@/app/components/DeckListCard";
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
  const [logOpen, setLogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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

  // Pencil button shown inline after the title when not editing
  const titleAction = !editingTitle ? (
    <button
      onClick={() => { setEditingTitle(true); setTitleInput(deckName); }}
      aria-label="Rename deck"
      className="flex-shrink-0 text-on-gradient opacity-50 hover:opacity-100 transition-opacity"
    >
      <svg
        className="w-5 h-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.75}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125"
        />
      </svg>
    </button>
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
      preOverviewSlot={
        <>
          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLogOpen((o) => !o)}
              className={`inline-flex items-center gap-1.5 rounded-full border border-transparent px-3 py-1.5 text-xs font-semibold transition-all ${
                logOpen ? "text-white" : "text-text-secondary"
              }`}
              style={{
                backgroundImage: logOpen
                  ? "linear-gradient(var(--accent), var(--accent)), var(--gradient-brand)"
                  : "linear-gradient(var(--bg), var(--bg)), var(--gradient-brand)",
                backgroundOrigin: "border-box",
                backgroundClip: "padding-box, border-box",
              }}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4.5v15m7.5-7.5h-15"
                />
              </svg>
              Log Match
            </button>
            {/* Public / Private toggle */}
            <button
              type="button"
              onClick={toggleVisibility}
              disabled={visibilityBusy}
              aria-pressed={isPublic}
              aria-label={isPublic ? "Make deck private" : "Make deck public"}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                isPublic
                  ? "border-transparent bg-accent text-white hover:bg-accent-light"
                  : "border-border bg-bg text-text-secondary hover:bg-surface-2"
              }`}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.75}
              >
                {isPublic ? (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                ) : (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
                  />
                )}
              </svg>
              {isPublic ? "Public" : "Private"}
            </button>
            <QRCodeButton deckList={deckList} analysis={analysis} />
            {/* Delete — icon-only, same visual weight as QR button */}
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={deleting}
              aria-label="Delete deck"
              className="inline-flex items-center justify-center rounded-full bg-black border border-transparent px-3 py-[7px] text-white disabled:opacity-50 transition-opacity hover:opacity-80 touch-manipulation"
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
                  d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                />
              </svg>
            </button>
          </div>

          {(initialMatches.length > 0 || logOpen) && (
            <MatchLog
              savedDeckId={savedDeckId}
              initialMatches={initialMatches}
              open={logOpen}
              onOpenChange={setLogOpen}
            />
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
                className="w-full max-w-sm rounded-2xl bg-white/95 backdrop-blur-xl border border-black/5 p-6 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.4)]"
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
                    className="inline-flex items-center justify-center rounded-full border border-black/10 bg-white px-4 py-1.5 text-xs font-semibold text-text-secondary hover:bg-black/5 transition touch-manipulation"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={performDelete}
                    disabled={deleting}
                    className="inline-flex items-center justify-center rounded-full bg-black px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50 hover:opacity-80 transition-opacity touch-manipulation"
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
        <>
          <DeckNotes savedDeckId={savedDeckId} initialNotes={initialNotes} />
          <DeckListCard deckList={deckList} />
        </>
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
