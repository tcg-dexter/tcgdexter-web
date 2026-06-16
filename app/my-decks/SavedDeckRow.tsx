"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import MatchForm, { type MatchFormData } from "@/app/components/MatchForm";
import QRCodeButton from "@/app/components/QRCodeButton";

interface SavedDeck {
  id: string;
  name: string;
  deck_list: string;
  analysis: {
    deckPrice?: number;
    metaMatch?: { archetypeName?: string | null };
    rotation?: { ready?: boolean };
  } | null;
  created_at: string;
  updated_at: string;
}

interface MatchStats {
  wins: number;
  losses: number;
  draws: number;
  lastPlayed: string | null;
}

interface Props {
  deck: SavedDeck;
  isLast: boolean;
  matchStats: MatchStats | null;
  /** Pre-built /u/[username]/[id] URL when the deck is public. Null otherwise. */
  shareUrl: string | null;
}

/**
 * Single row in the My Decks list.
 *
 * Collapsed: two rows — (1) deck name + pencil icon + W-L below, (2) quick action buttons.
 * Tapping the row navigates to the deck profile.
 * Log Match button expands an inline match form.
 * Pencil icon triggers inline rename.
 */
export default function SavedDeckRow({
  deck,
  isLast,
  matchStats,
  shareUrl,
}: Props) {
  const router = useRouter();
  const [quicklogOpen, setQuicklogOpen] = useState(false);

  const name = deck.name;

  const wins = matchStats?.wins ?? 0;
  const losses = matchStats?.losses ?? 0;
  const draws = matchStats?.draws ?? 0;
  const totalMatches = wins + losses + draws;

  const wlRecord = totalMatches > 0 && (
    <span className="flex-shrink-0 inline-flex items-baseline tabular-nums font-bold text-[10px] leading-none bg-black rounded-full px-2 py-[3px] text-white">
      <span>{wins}</span>
      <span className="mx-[3px]">-</span>
      <span>{losses}</span>
      {draws > 0 && (
        <>
          <span className="mx-[3px]">-</span>
          <span>{draws}</span>
        </>
      )}
    </span>
  );

  // ── Handlers ────────────────────────────────────────────────

  function handleRowClick() {
    router.push(`/my-decks/${deck.id}`);
  }

  async function handleQuickLog(data: MatchFormData) {
    const res = await fetch("/api/matches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saved_deck_id: deck.id, ...data }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? "Failed to log match.");
    }
    setQuicklogOpen(false);
    router.refresh();
  }


  return (
    <div className={`bg-white${isLast ? "" : " border-b border-bg"}`}>
      {/* ── Collapsed row ──────────────────────────────────── */}
      <div
        className="px-5 py-3.5 cursor-pointer flex items-center gap-3"
        onClick={handleRowClick}
      >
        {/* Left content */}
        <div className="flex-1 min-w-0">
          {/* Row 1: deck name + W-L */}
          <div className="flex items-center gap-1.5 mb-2">
            <span className="font-semibold text-text-primary text-lg truncate min-w-0">
              {name}
            </span>
            {wlRecord}
          </div>

          {/* Row 2: action buttons */}
          <div
            className="flex w-full items-center justify-around"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setQuicklogOpen((o) => !o)}
              className={`inline-flex items-center gap-1.5 rounded-full border border-transparent px-3 py-1.5 text-xs font-semibold transition-all ${
                quicklogOpen ? "text-white" : "text-text-secondary"
              }`}
              style={{
                backgroundImage: quicklogOpen
                  ? "linear-gradient(var(--accent), var(--accent)), var(--gradient-brand)"
                  : "linear-gradient(var(--bg), var(--bg)), var(--gradient-brand)",
                backgroundOrigin: "border-box",
                backgroundClip: "padding-box, border-box",
              }}
            >
              Log Match
            </button>
            <QRCodeButton
              shareUrl={shareUrl ?? undefined}
              deckList={deck.deck_list}
              analysis={deck.analysis as unknown}
            />
          </div>
        </div>

        {/* Right chevron */}
        <svg
          className="flex-shrink-0 w-4 h-4 text-text-muted"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.25 4.5l7.5 7.5-7.5 7.5"
          />
        </svg>
      </div>

      {/* ── Quick-log expand ────────────────────────────────── */}
      {quicklogOpen && (
        <div className="px-5 pb-4">
          <MatchForm
            onSubmit={handleQuickLog}
            onCancel={() => setQuicklogOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
