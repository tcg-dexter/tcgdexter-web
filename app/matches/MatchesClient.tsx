"use client";

import { useMemo, useState } from "react";
import PillSelect from "@/app/components/ui/PillSelect";
import { MatchCard, type RecentMatch } from "@/app/components/MatchCard";
import { normalizeForSearch } from "@/lib/searchNormalize";

interface Props {
  matches: RecentMatch[];
}

type SortDir = "desc" | "asc";

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

export default function MatchesClient({ matches }: Props) {
  const [query, setQuery] = useState("");
  const [dir, setDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = normalizeForSearch(query.trim());
    const base = q
      ? matches.filter((m) => normalizeForSearch(matchSearchText(m)).includes(q))
      : matches;
    const sorted = [...base].sort((a, b) => {
      const av = new Date(a.createdAt).getTime();
      const bv = new Date(b.createdAt).getTime();
      return dir === "asc" ? av - bv : bv - av;
    });
    return sorted;
  }, [matches, query, dir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
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
        </div>
      </div>

      {pageItems.length === 0 ? (
        <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm p-8 text-center">
          <p className="text-sm text-text-secondary">No matches found{query ? ` for "${query}"` : ""}.</p>
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
