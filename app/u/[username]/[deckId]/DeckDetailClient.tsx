"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import BackButton from "@/app/components/ui/BackButton";
import DeckProfileView, {
  type AnalysisResult,
  type DeckCreator,
} from "@/app/components/DeckProfileView";
import QRCodeButton from "@/app/components/QRCodeButton";
import CopyDeckListButton from "@/app/components/CopyDeckListButton";
import LikeButton from "@/app/components/LikeButton";
import { WLCircles } from "@/app/components/DeckPostCard";
import EditDeckDialog from "@/app/components/EditDeckDialog";
import MatchLog from "@/app/my-decks/[id]/MatchLog";
import DeckNotes from "@/app/my-decks/[id]/DeckNotes";
import type { GamePrize } from "@/lib/bo3";
import { primaryCardImageUrl, deckAvatarInfo, pokemonSlug } from "@/lib/primaryCardImage";
import { typeColor } from "@/lib/metaPrimaryCard";

interface Match {
  id: string;
  result: "win" | "loss" | "draw";
  opponent_name: string | null;
  opponent_archetype: string | null;
  opponent_deck_list: string | null;
  notes: string | null;
  played_at: string;
  source?: "manual" | "tcg_live_log";
  game_results?: string | null;
  prizes_taken_player?: number | null;
  prizes_taken_opponent?: number | null;
  game_prizes?: GamePrize[] | null;
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const actionRowRef = useRef<HTMLDivElement>(null);

  // Bring the action row to the top of the viewport when the match log
  // form opens. Closing (e.g. after a save) intentionally doesn't scroll.
  useEffect(() => {
    if (logOpen) {
      actionRowRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [logOpen]);

  // Close the settings menu on outside click / Escape. We check both the
  // gear button's wrapper and the menu element itself because the menu is
  // rendered as a sibling of the gear button (escaping the overflow-hidden
  // wrapper that would otherwise clip it).
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

  const avatar = deckAvatarInfo(analysis.cards ?? [], coverImageUrl);
  const avatarSlug = avatar ? pokemonSlug(avatar.name) : "";
  const avatarUrl = avatarSlug
    ? `https://r2.limitlesstcg.net/pokemon/gen9/${avatarSlug}.png`
    : null;
  const avatarBg = avatar ? typeColor(avatar.types) : "#B0A89E";
  const titleLeading = avatarUrl ? (
    <span
      className="w-9 h-9 sm:w-10 sm:h-10 rounded-full shrink-0 inline-flex items-center justify-center overflow-hidden ring-1 ring-black/[0.06]"
      style={{ background: avatarBg }}
      aria-hidden
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={avatarUrl} alt="" className="w-[28px] h-[28px] sm:w-[32px] sm:h-[32px] object-contain" />
    </span>
  ) : null;

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
    if (coverUrl !== coverImageUrl) payload.cover_image_url = coverUrl;

    // A new deck list needs a fresh analysis snapshot — compute it the same
    // way the home page does, then persist both together.
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

    // Deck-list changes alter every analysis-driven module (and price/rotation)
    // — re-fetch the server component so the whole profile reflects the update.
    if (deckListChanged) router.refresh();
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
        titleLeading={titleLeading}
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
        // "Profile your own deck" only makes sense for an anonymous
        // visitor — a signed-in user already has an account.
        footerCta={isAuthenticated ? null : undefined}
      />
    );
  }

  // Owner rendering — title row only carries the right-anchored W-L record.
  // The settings gear lives in the action row below (opens a dropdown with
  // Edit deck and Delete deck).
  const wins = initialMatches.filter((m) => m.result === "win").length;
  const losses = initialMatches.filter((m) => m.result === "loss").length;
  const draws = initialMatches.filter((m) => m.result === "draw").length;

  const titleAction = (
    <div className="ml-auto">
      <WLCircles wl={{ w: wins, l: losses, d: draws }} />
    </div>
  );

  return (
    <DeckProfileView
      variant="saved"
      deckList={deckList}
      analysis={analysis}
      profiledAt={profiledAt}
      pageTitle={deckName}
      titleLeading={titleLeading}
      titleAction={titleAction}
      subtitle={false}
      shareUrl={shareUrl}
      preTitle={
        <BackButton
          href={`/u/${username}`}
          ariaLabel={`Back to @${username}'s decks`}
        />
      }
      postStatsSlot={
        <>
          <div
            ref={actionRowRef}
            className={`relative flex items-center transition-all duration-300 ${
              logOpen ? "gap-0" : "gap-3"
            }`}
          >
            <button
              onClick={() => setLogOpen((o) => !o)}
              className={`flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 rounded-full border border-transparent px-[1px] py-2 text-sm font-semibold transition-all ${
                logOpen ? "text-white" : "text-text-secondary"
              }`}
              style={{
                backgroundImage: logOpen
                  ? "linear-gradient(black, black), linear-gradient(black, black)"
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
                deckList={deckList}
                analysis={analysis}
                className="flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 rounded-full border border-transparent bg-gradient-brand-reverse bg-origin-border px-[1px] py-2 text-sm font-semibold text-white shadow-brand hover:shadow-brand-lg transition disabled:opacity-50"
              />
              {/* Settings — icon-only, same visual weight as QR button.
                  Dropdown menu lives outside this wrapper (below) so the
                  ancestor `overflow-hidden` doesn't clip it. */}
              <div ref={settingsRef} className="flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => setSettingsOpen((o) => !o)}
                  aria-label="Deck settings"
                  aria-haspopup="menu"
                  aria-expanded={settingsOpen}
                  className="w-full inline-flex items-center justify-center rounded-full bg-black border border-transparent px-[1px] py-[11px] text-white disabled:opacity-50 transition-opacity hover:opacity-80 touch-manipulation"
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
            {settingsOpen && !logOpen && (
              <div
                ref={settingsMenuRef}
                role="menu"
                className="absolute right-0 top-full mt-2 w-44 rounded-xl bg-white border border-black/8 shadow-lg p-1 z-20"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setEditOpen(true);
                    setSettingsOpen(false);
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
              </div>
            )}
          </div>

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

          <EditDeckDialog
            open={editOpen}
            onClose={() => setEditOpen(false)}
            initialName={deckName}
            cards={analysis.cards ?? []}
            currentCoverUrl={coverImageUrl}
            defaultCoverUrl={primaryCardImageUrl(analysis.cards ?? [])}
            initialDeckList={deckList}
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
        <DeckNotes savedDeckId={savedDeckId} initialNotes={initialNotes} />
      }
      // The owner is viewing their own saved deck — never show
      // "Profile your own deck".
      footerCta={null}
    />
  );
}
