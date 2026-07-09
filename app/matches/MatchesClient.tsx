"use client";

import { useMemo, useState } from "react";
import PillSelect from "@/app/components/ui/PillSelect";
import { MatchCard, type RecentMatch } from "@/app/components/MatchCard";
import { normalizeForSearch } from "@/lib/searchNormalize";
import PlayerLeaderboard from "./PlayerLeaderboard";
import FeaturedMatchHero from "./FeaturedMatchHero";
import type { LeaderboardPlayer } from "@/lib/player-leaderboard";

interface Props {
  matches: RecentMatch[];
  /** Highest-total-damage match from the last 7 days, picked server-side.
   *  Null when nothing in the window has a parsed battle log with damage. */
  featuredMatch?: RecentMatch | null;
  leaderboard: LeaderboardPlayer[];
  currentUsername?: string | null;
}

type SortDir = "desc" | "asc";
type FilterKey = "myMatches" | "hasBattleLog" | "hasMeta" | "singleMatch" | "bestOf3";
type ViewMode = "sections" | "browse";

const PAGE_SIZE = 20;

function matchSearchText(m: RecentMatch): string {
  return [
    m.deckName,
    m.username,
    m.opponentArchetype,
    m.opponentHandle,
    m.opponentAttackerName,
    ...m.deckCardNames,
  ]
    .filter(Boolean)
    .join(" ");
}

function applyFilter(m: RecentMatch, key: FilterKey, currentUsername: string | null): boolean {
  switch (key) {
    case "myMatches":   return m.username === currentUsername;
    case "hasBattleLog": return m.hasBattleLog;
    case "hasMeta":     return m.opponentArchetype !== null;
    case "singleMatch": return !m.isBestOf3;
    case "bestOf3":     return m.isBestOf3;
  }
}

function bucketMatches(matches: RecentMatch[]) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const sevenDaysAgoStart = todayStart - 7 * 24 * 60 * 60 * 1000;
  const monthStartMs = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const today: RecentMatch[] = [];
  const thisWeek: RecentMatch[] = [];
  const thisMonth: RecentMatch[] = [];
  for (const m of matches) {
    const t = new Date(m.createdAt).getTime();
    if (t >= todayStart) today.push(m);
    else if (t >= sevenDaysAgoStart) thisWeek.push(m);
    else if (t >= monthStartMs) thisMonth.push(m);
  }
  return { today, thisWeek, thisMonth };
}

export default function MatchesClient({
  matches,
  featuredMatch = null,
  leaderboard,
  currentUsername = null,
}: Props) {
  const [mode, setMode] = useState<"matches" | "leaderboard">("matches");
  const [viewMode, setViewMode] = useState<ViewMode>("sections");
  const [query, setQuery] = useState("");
  const [dir, setDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<FilterKey>>(new Set());

  const toggleFilter = (key: FilterKey) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
    setPage(1);
  };

  const clearFilters = () => {
    setActiveFilters(new Set());
    setPage(1);
  };

  // Any active search or filter overrides the view — always show all content.
  const isSearching = query.trim().length > 0 || activeFilters.size > 0;
  const effectiveViewMode: ViewMode = isSearching ? "browse" : viewMode;

  const activeFilterCount = activeFilters.size;

  const filtered = useMemo(() => {
    const q = normalizeForSearch(query.trim());
    let base = q
      ? matches.filter((m) => normalizeForSearch(matchSearchText(m)).includes(q))
      : matches;

    activeFilters.forEach((key) => {
      base = base.filter((m) => applyFilter(m, key, currentUsername));
    });

    const sorted = [...base].sort((a, b) => {
      const av = new Date(a.createdAt).getTime();
      const bv = new Date(b.createdAt).getTime();
      return dir === "asc" ? av - bv : bv - av;
    });
    return sorted;
  }, [matches, query, dir, activeFilters, currentUsername]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const filterDefs: Array<{ key: FilterKey; label: string }> = [
    ...(currentUsername ? [{ key: "myMatches" as FilterKey, label: "My Matches" }] : []),
    { key: "hasBattleLog",  label: "Includes Battle Log" },
    { key: "hasMeta",       label: "Includes Meta Archetype" },
    { key: "singleMatch",   label: "Single Match" },
    { key: "bestOf3",       label: "Best of 3" },
  ];

  const buckets = useMemo(() => bucketMatches(matches), [matches]);

  return (
    <>
      {/* Header: title + view toggle (mirrors the Card Catalog data toggle) */}
      <div className="mb-6 flex items-end justify-between gap-3">
        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-text-primary">
          Matches
        </h2>
        <button
          type="button"
          onClick={() => setMode((m) => (m === "leaderboard" ? "matches" : "leaderboard"))}
          aria-pressed={mode === "leaderboard"}
          aria-label={mode === "leaderboard" ? "Switch to matches view" : "Switch to leaderboard"}
          title={mode === "leaderboard" ? "Switch to matches view" : "Switch to leaderboard"}
          className={`inline-flex items-center justify-center h-[38px] w-[38px] rounded-full border transition-colors shrink-0 ${
            mode === "leaderboard"
              ? "border-transparent bg-black text-white"
              : "border-black/10 bg-white text-text-primary hover:bg-surface"
          }`}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-4 h-4"
          >
            <path d="M7 6.5h10" />
            <path d="M7 10h10" />
            <path d="M7 13.5h10" />
            <path d="M3.5 6.5h.01" />
            <path d="M3.5 10h.01" />
            <path d="M3.5 13.5h.01" />
          </svg>
        </button>
      </div>

      {mode === "leaderboard" ? (
        <PlayerLeaderboard players={leaderboard} currentUsername={currentUsername} />
      ) : (
      <>
      {/* Featured Match hero — shown in the default "sections" view; a
          search or filter takes over the surface, so the hero yields when
          the user is drilling into something specific. */}
      {featuredMatch && !isSearching && effectiveViewMode === "sections" && (
        <FeaturedMatchHero match={featuredMatch} />
      )}
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
        <div className="flex-1 relative">
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
            placeholder="Search matches"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="w-full pl-10 pr-4 py-2 rounded-full border border-black/10 bg-white text-[16px] sm:text-sm focus:outline-none focus-gradient-border transition-colors"
          />
        </div>
        <div className="flex items-center gap-2">
          <PillSelect
            value={dir}
            onChange={(e) => {
              setDir(e.target.value as SortDir);
              setPage(1);
            }}
          >
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </PillSelect>
          <button
            onClick={() => setShowFilters((s) => !s)}
            className={`text-xs font-semibold h-[38px] px-3 rounded-full transition ${
              activeFilterCount > 0
                ? "border border-transparent bg-gradient-brand bg-origin-border text-white shadow-brand hover:shadow-brand-lg"
                : "border border-black/10 bg-white hover:bg-surface"
            }`}
          >
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </button>
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="rounded-2xl border border-black/8 bg-white p-4 mb-4">
          {activeFilterCount > 0 && (
            <div className="pb-3 mb-3 border-b border-black/8">
              <button
                onClick={clearFilters}
                className="text-xs font-semibold px-3 py-1.5 rounded-full border border-black/10 bg-white hover:bg-surface transition-colors"
              >
                Clear all filters
              </button>
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {filterDefs.map(({ key, label }) => {
              const on = activeFilters.has(key);
              return (
                <button
                  key={key}
                  onClick={() => toggleFilter(key)}
                  className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                    on
                      ? "bg-black text-white border-transparent"
                      : "bg-white text-text-secondary border-black/10 hover:bg-surface"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Sections view: Today / This Week / This Month ────────── */}
      {effectiveViewMode === "sections" && (
        <>
          {buckets.today.length + buckets.thisWeek.length + buckets.thisMonth.length > 0 ? (
            <div className="flex flex-col gap-8">
              {buckets.today.length > 0 && (
                <MatchSection title="Today" matches={buckets.today} />
              )}
              {buckets.thisWeek.length > 0 && (
                <MatchSection title="This Week" matches={buckets.thisWeek} />
              )}
              {buckets.thisMonth.length > 0 && (
                <MatchSection title="This Month" matches={buckets.thisMonth} />
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm p-8 text-center">
              <p className="text-sm text-text-secondary">No recent matches yet.</p>
            </div>
          )}
          <div className="mt-8 flex justify-center">
            <button
              onClick={() => { setViewMode("browse"); setPage(1); }}
              className="rounded-full bg-black text-white text-sm font-semibold px-6 py-3 hover:bg-black/85 transition-colors"
            >
              View All
            </button>
          </div>
        </>
      )}

      {/* ── Browse view: paginated all-matches list ───────────────── */}
      {effectiveViewMode === "browse" && (
        <>
          {!isSearching && (
            <button
              onClick={() => { setViewMode("sections"); setPage(1); }}
              className="mb-4 flex items-center gap-1 text-xs font-semibold text-text-muted hover:text-text-primary transition-colors"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              Recent
            </button>
          )}
          {pageItems.length === 0 ? (
            <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm p-8 text-center">
              <p className="text-sm text-text-secondary">
                No matches found{query ? ` for "${query}"` : ""}.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {pageItems.map((m) => (
                <MatchCard key={m.id} match={m} />
              ))}
            </div>
          )}
          {totalPages > 1 && (
            <Pagination page={page} totalPages={totalPages} onPage={setPage} />
          )}
        </>
      )}
      </>
      )}
    </>
  );
}

function MatchSection({ title, matches }: { title: string; matches: RecentMatch[] }) {
  return (
    <section>
      <div className="flex items-baseline gap-3 lg:gap-[18px] mb-3 lg:mb-[18px]">
        <h2 className="text-sm lg:text-[22px] font-black uppercase tracking-[0.15em] text-text-primary">
          {title}
        </h2>
        <span className="h-px flex-1 bg-text-primary/15" />
        <span className="shrink-0 rounded-full bg-black text-white text-[11px] lg:text-[17px] font-bold px-2.5 lg:px-[15px] py-0.5 lg:py-[3px] tabular-nums">
          {matches.length}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {matches.map((m) => (
          <MatchCard key={m.id} match={m} />
        ))}
      </div>
    </section>
  );
}

function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  const canPrev = page > 1;
  const canNext = page < totalPages;
  return (
    <div className="mt-6 flex items-center justify-center gap-2">
      <button
        onClick={() => onPage(page - 1)}
        disabled={!canPrev}
        className="text-xs font-semibold px-3 py-1.5 rounded-full border border-black/10 bg-white disabled:opacity-40 hover:bg-surface transition-colors"
      >
        ← Prev
      </button>
      <span className="text-xs text-text-secondary">
        Page {page} of {totalPages}
      </span>
      <button
        onClick={() => onPage(page + 1)}
        disabled={!canNext}
        className="text-xs font-semibold px-3 py-1.5 rounded-full border border-black/10 bg-white disabled:opacity-40 hover:bg-surface transition-colors"
      >
        Next →
      </button>
    </div>
  );
}
