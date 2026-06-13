"use client";

import { useMemo, useState } from "react";
import PillSelect from "@/app/components/ui/PillSelect";
import { MetaDeckCard, type MetaDeckCardProps } from "@/app/components/DeckPostCard";
import { normalizeForSearch } from "@/lib/searchNormalize";

export interface MetaDeckItem extends MetaDeckCardProps {
  counts: { pokemon: number; trainer: number; energy: number };
}

interface Props {
  items: MetaDeckItem[];
}

type SortKey =
  | "name"
  | "representation"
  | "likes"
  | "pokemon"
  | "trainer"
  | "energy";
type SortDir = "asc" | "desc";

function sortValue(item: MetaDeckItem, key: SortKey): number | string {
  switch (key) {
    case "name":
      return item.name.toLowerCase();
    case "representation":
      return item.representation_pct;
    case "likes":
      return item.like_count ?? 0;
    case "pokemon":
      return item.counts.pokemon;
    case "trainer":
      return item.counts.trainer;
    case "energy":
      return item.counts.energy;
  }
}

export default function MetaDecksClient({ items }: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("representation");
  const [dir, setDir] = useState<SortDir>("desc");

  const filtered = useMemo(() => {
    const q = normalizeForSearch(query.trim());
    const base = q ? items.filter((d) => normalizeForSearch(d.name).includes(q)) : items;
    const sorted = [...base].sort((a, b) => {
      const av = sortValue(a, sort);
      const bv = sortValue(b, sort);
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [items, query, sort, dir]);

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
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search decks"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="w-full pl-10 pr-4 py-2 rounded-full border border-black/10 bg-white text-[16px] sm:text-sm focus:outline-none focus-gradient-border transition-colors"
          />
        </div>
        <div className="flex items-center gap-2">
          <PillSelect
            value={`${sort}:${dir}`}
            onChange={(e) => {
              const [s, d] = e.target.value.split(":") as [SortKey, SortDir];
              setSort(s);
              setDir(d);
            }}
          >
            <option value="representation:desc">Meta Share (Descending)</option>
            <option value="representation:asc">Meta Share (Ascending)</option>
            <option value="name:asc">Deck Name (A–Z)</option>
            <option value="name:desc">Deck Name (Z–A)</option>
            <option value="likes:desc">Likes (Descending)</option>
            <option value="likes:asc">Likes (Ascending)</option>
            <option value="pokemon:desc">Pokémon Card Count (Descending)</option>
            <option value="pokemon:asc">Pokémon Card Count (Ascending)</option>
            <option value="trainer:desc">Trainer Card Count (Descending)</option>
            <option value="trainer:asc">Trainer Card Count (Ascending)</option>
            <option value="energy:desc">Energy Card Count (Descending)</option>
            <option value="energy:asc">Energy Card Count (Ascending)</option>
          </PillSelect>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm p-8 text-center">
          <p className="text-sm text-text-secondary">No decks match “{query}”.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((item, i) => (
            <MetaDeckCard
              key={item.id}
              id={item.id}
              name={item.name}
              image_url={item.image_url}
              icon_url={item.icon_url}
              icon_bg={item.icon_bg}
              representation_pct={item.representation_pct}
              like_count={item.like_count}
              creators={item.creators}
              index={i}
            />
          ))}
        </div>
      )}
    </>
  );
}
