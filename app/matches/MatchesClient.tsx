"use client";

import { useMemo, useState } from "react";
import PillSelect from "@/app/components/ui/PillSelect";
import { MatchCard, type RecentMatch } from "@/app/components/MatchCard";
import { normalizeForSearch } from "@/lib/searchNormalize";

interface Props {
  matches: RecentMatch[];
  currentUsername?: string | null;
}

type SortDir = "desc" | "asc";
type FilterKey = "myMatches" | "hasBattleLog" | "hasMeta" | "singleMatch" | "bestOf3";

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

export default function MatchesClient({ matches, currentUsername = null }: Props) {
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

  return (
    <>
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

      {/* Results */}
      {pageItems.length === 0 ? (
        <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm p-8 text-center">
          <p className="text-sm text-text-secondary">
            No matches found{query ? ` for "${query}"` : ""}.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {pageItems.map((m) => (
            <MatchCard key={m.id} match={m} compact />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onPage={setPage} />
      )}
    </>
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
