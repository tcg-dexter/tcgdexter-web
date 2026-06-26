"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { LeaderboardPlayer } from "@/lib/player-leaderboard";
import { normalizeForSearch } from "@/lib/searchNormalize";

interface Props {
  players: LeaderboardPlayer[];
  currentUsername?: string | null;
}

const PAGE_SIZE = 30;

/**
 * Leaderboard table of every public player with recorded matches — wins,
 * losses, and win percentage, ranked by wins. Mirrors the card catalog's
 * alternate "data view" pattern as the matches page's toggled presentation.
 */
export default function PlayerLeaderboard({ players, currentUsername = null }: Props) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = normalizeForSearch(query.trim());
    if (!q) return players;
    return players.filter((p) =>
      normalizeForSearch(`${p.displayName} ${p.username}`).includes(q),
    );
  }, [players, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  // Rank is absolute (across the full ranked list), not per-page.
  const startRank = (page - 1) * PAGE_SIZE;

  if (players.length === 0) {
    return (
      <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm p-8 text-center">
        <p className="text-sm text-text-secondary">
          No public players with recorded matches yet.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Search */}
      <div className="relative">
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted"
        >
          <circle cx="9" cy="9" r="6" />
          <path d="m17 17-3.5-3.5" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          placeholder="Search players"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="w-full pl-10 pr-4 py-2 rounded-full border border-black/10 bg-white text-[16px] sm:text-sm focus:outline-none focus-gradient-border transition-colors"
        />
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-black/8 bg-white shadow-sm">
        {/* Header row */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-black/8 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          <span className="w-6 shrink-0 text-right">#</span>
          <span className="flex-1 min-w-0">Player</span>
          <span className="w-20 shrink-0 text-right tabular-nums">Matches</span>
          <span className="w-14 shrink-0 text-right tabular-nums">Win %</span>
        </div>

        {pageItems.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-text-secondary">
            No players match &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <ul>
            {pageItems.map((p, i) => {
              const rank = startRank + i + 1;
              const isMe = !!currentUsername && p.username === currentUsername;
              return (
                <li key={p.username}>
                  <Link
                    href={`/u/${p.username}`}
                    className={`flex items-center gap-3 px-4 py-2.5 border-b border-black/5 last:border-b-0 transition-colors hover:bg-surface/70 ${
                      isMe ? "bg-accent/5" : ""
                    }`}
                  >
                    <span
                      className={`w-6 shrink-0 text-right text-sm font-bold tabular-nums ${
                        rank <= 3 ? "text-accent" : "text-text-muted"
                      }`}
                    >
                      {rank}
                    </span>

                    <span className="flex-1 min-w-0 flex items-center gap-2.5">
                      <span className="w-7 h-7 shrink-0 rounded-full overflow-hidden bg-surface flex items-center justify-center">
                        {p.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.avatarUrl}
                            alt=""
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <span className="text-xs font-bold text-text-muted">
                            {p.displayName.trim().charAt(0).toUpperCase() || "?"}
                          </span>
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-text-primary truncate">
                          {p.displayName}
                          {isMe && (
                            <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wider text-accent">
                              You
                            </span>
                          )}
                        </span>
                        <span className="block text-xs text-text-muted truncate">
                          @{p.username}
                        </span>
                      </span>
                    </span>

                    <span className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums text-text-primary">
                      {p.games}
                    </span>
                    <span className="w-14 shrink-0 text-right text-sm font-bold tabular-nums text-text-primary">
                      {p.winPct == null ? "—" : `${Math.round(p.winPct)}%`}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => setPage((n) => Math.max(1, n - 1))}
            disabled={page <= 1}
            className="text-xs font-semibold px-3 py-1.5 rounded-full border border-black/10 bg-white disabled:opacity-40 hover:bg-surface transition-colors"
          >
            ← Prev
          </button>
          <span className="text-xs text-text-secondary">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((n) => Math.min(totalPages, n + 1))}
            disabled={page >= totalPages}
            className="text-xs font-semibold px-3 py-1.5 rounded-full border border-black/10 bg-white disabled:opacity-40 hover:bg-surface transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
