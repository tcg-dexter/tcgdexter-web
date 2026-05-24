"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import BackButton from "@/app/components/ui/BackButton";
import DeckProfileView, {
  type AnalysisResult,
  type DeckCreator,
} from "@/app/components/DeckProfileView";
import QRCodeButton from "@/app/components/QRCodeButton";
import CopyDeckListButton from "@/app/components/CopyDeckListButton";
import LikeButton from "@/app/components/LikeButton";
import EditDeckDialog from "@/app/components/EditDeckDialog";
import MatchLog, { type SharedDeckMatchRow } from "@/app/my-decks/[id]/MatchLog";
import DeckNotes from "@/app/my-decks/[id]/DeckNotes";
import { primaryCardImageUrl } from "@/lib/primaryCardImage";

interface Match {
  id: string;
  result: "win" | "loss" | "draw";
  opponent_name: string | null;
  opponent_archetype: string | null;
  opponent_deck_list: string | null;
  notes: string | null;
  played_at: string;
  source?: "manual" | "tcg_live_log";
}

interface ParsedCard {
  qty: number;
  name: string;
  setCode: string;
  number: string;
}
interface ParsedSection {
  label: string;
  cards: ParsedCard[];
}

const CATEGORY_MAP: Record<string, string> = {
  "pokémon": "Pokémon",
  "pokemon": "Pokémon",
  "trainer": "Trainer",
  "energy": "Energy",
};

function parseDeckList(raw: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const headerMatch = trimmed.match(/^([^:]+):\s*\d+/);
    if (headerMatch) {
      const key = headerMatch[1].toLowerCase();
      if (key in CATEGORY_MAP) {
        current = { label: CATEGORY_MAP[key], cards: [] };
        sections.push(current);
        continue;
      }
    }
    if (current) {
      const tokens = trimmed.split(/\s+/);
      const qty = parseInt(tokens[0]);
      if (!isNaN(qty) && tokens.length >= 4) {
        current.cards.push({
          qty,
          name: tokens.slice(1, tokens.length - 2).join(" "),
          setCode: tokens[tokens.length - 2],
          number: tokens[tokens.length - 1],
        });
      }
    }
  }
  return sections;
}

interface Props {
  isOwner: boolean;
  username: string;
  savedDeckId: string;
  deckList: string;
  analysis: AnalysisResult;
  profiledAt: string;
  pageTitle: string;
  initialIsPublic: boolean;
  canonicalShareUrl: string;
  initialMatches: Match[];
  initialSharedMatches: SharedDeckMatchRow[];
  viewerId: string | null;
  initialNotes: string;
  initialLiked: boolean;
  initialLikeCount: number;
  isAuthenticated: boolean;
  creator: DeckCreator | null;
  initialCoverImageUrl: string | null;
}

export default function DeckDetailClient({
  isOwner,
  username,
  savedDeckId,
  deckList,
  analysis,
  profiledAt,
  pageTitle,
  initialIsPublic,
  canonicalShareUrl,
  initialMatches,
  initialSharedMatches,
  viewerId,
  initialNotes,
  initialLiked,
  initialLikeCount,
  isAuthenticated,
  creator,
  initialCoverImageUrl,
}: Props) {
  const router = useRouter();
  const [logOpen, setLogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(initialCoverImageUrl);

  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [visibilityBusy, setVisibilityBusy] = useState(false);

  const [deckName, setDeckName] = useState(pageTitle);
  const [editOpen, setEditOpen] = useState(false);

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
      if (!res.ok) setIsPublic(!next);
    } catch {
      setIsPublic(!next);
    } finally {
      setVisibilityBusy(false);
    }
  }

  async function handleEditSave({
    name,
    coverUrl,
  }: {
    name: string;
    coverUrl: string | null;
  }) {
    const payload: { name?: string; cover_image_url?: string | null } = {};
    if (name !== deckName) payload.name = name;
    if (coverUrl !== coverImageUrl) payload.cover_image_url = coverUrl;
    if (Object.keys(payload).length === 0) return;

    const prevName = deckName;
    const prevCover = coverImageUrl;
    if ("name" in payload) setDeckName(name);
    if ("cover_image_url" in payload) setCoverImageUrl(coverUrl);

    try {
      const res = await fetch(`/api/saved-decks/${savedDeckId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setDeckName(prevName);
        setCoverImageUrl(prevCover);
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Failed to save changes.");
      }
    } catch (e) {
      setDeckName(prevName);
      setCoverImageUrl(prevCover);
      throw e;
    }
  }

  async function performDelete() {
    setConfirmingDelete(false);
    setDeleting(true);
    try {
      const res = await fetch(`/api/saved-decks/${savedDeckId}`, {
        method: "DELETE",
      });
      if (res.ok) router.push(`/u/${username}`);
    } catch {
      // silent — user can retry
    } finally {
      setDeleting(false);
    }
  }

  const shareUrl = isOwner
    ? isPublic
      ? canonicalShareUrl
      : undefined
    : canonicalShareUrl;

  // Visitor rendering
  if (!isOwner) {
    return (
      <DeckProfileView
        variant="shared"
        deckList={deckList}
        analysis={analysis}
        profiledAt={profiledAt}
        pageTitle={pageTitle}
        creator={creator ?? undefined}
        shareUrl={canonicalShareUrl}
        preTitle={
          <BackButton
            href={`/u/${username}`}
            ariaLabel={`Back to @${username}'s decks`}
          />
        }
        subtitle={
          <div className="flex items-center gap-2">
            <LikeButton
              deckId={savedDeckId}
              initialLiked={initialLiked}
              initialCount={initialLikeCount}
              isAuthenticated={isAuthenticated}
            />
            <CopyDeckListButton deckList={deckList} />
          </div>
        }
        topSlot={
          initialSharedMatches.length > 0 ? (
            <MatchLog
              savedDeckId={savedDeckId}
              initialMatches={[]}
              initialSharedMatches={initialSharedMatches}
              readOnly
              viewerId={viewerId}
            />
          ) : undefined
        }
      />
    );
  }

  // Owner rendering — ellipsis button trailing the title opens the unified
  // edit dialog (name + cover image).
  const titleAction = (
    <button
      type="button"
      onClick={() => setEditOpen(true)}
      aria-label="Edit deck"
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
          d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z"
        />
      </svg>
    </button>
  );

  return (
    <DeckProfileView
      variant="saved"
      deckList={deckList}
      analysis={analysis}
      profiledAt={profiledAt}
      pageTitle={deckName}
      titleAction={titleAction}
      subtitle={false}
      shareUrl={shareUrl}
      preTitle={
        <BackButton
          href={`/u/${username}`}
          ariaLabel={`Back to @${username}'s decks`}
        />
      }
      preOverviewSlot={
        <>
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
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Log Match
            </button>
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

          {(initialMatches.length > 0 || initialSharedMatches.length > 0 || logOpen) && (
            <MatchLog
              savedDeckId={savedDeckId}
              initialMatches={initialMatches}
              initialSharedMatches={initialSharedMatches}
              viewerId={viewerId}
              open={logOpen}
              onOpenChange={setLogOpen}
            />
          )}

          <EditDeckDialog
            open={editOpen}
            onClose={() => setEditOpen(false)}
            initialName={deckName}
            cards={analysis.cards ?? []}
            currentCoverUrl={coverImageUrl}
            defaultCoverUrl={primaryCardImageUrl(analysis.cards ?? [])}
            onSave={handleEditSave}
          />

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
                <p className="mt-2 text-sm text-text-secondary">This cannot be undone.</p>
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

          <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-text-primary">Deck List</h2>
              <CopyDeckListButton deckList={deckList} iconOnly />
            </div>
            {parseDeckList(deckList).map((section) => (
              <div key={section.label} className="mb-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-1.5">
                  {section.label} — {section.cards.reduce((s, c) => s + c.qty, 0)}
                </h4>
                <div className="space-y-0.5">
                  {section.cards.map((c, i) => (
                    <div key={i} className="flex items-baseline gap-2 text-sm">
                      <span className="text-text-muted w-5 text-right flex-shrink-0">×{c.qty}</span>
                      <span className="text-text-primary">{c.name}</span>
                      <span className="text-text-muted text-xs">
                        {c.setCode} {c.number}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      }
    />
  );
}
