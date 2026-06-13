"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import SectionHeader from "@/app/components/ui/SectionHeader";
import PillSelect from "@/app/components/ui/PillSelect";
import { UserDeckCard, type UserDeckCardProps } from "@/app/components/DeckPostCard";
import { normalizeForSearch } from "@/lib/searchNormalize";

interface Props {
  decks: UserDeckCardProps[];
}

type SortKey =
  | "date"
  | "name"
  | "wins"
  | "likes"
  | "pokemon"
  | "trainer"
  | "energy";
type SortDir = "asc" | "desc";

function sortValue(deck: UserDeckCardProps, key: SortKey): number | string {
  switch (key) {
    case "date":
      return deck.createdAt ? new Date(deck.createdAt).getTime() : 0;
    case "name":
      return deck.name.toLowerCase();
    case "wins":
      return deck.wl?.w ?? 0;
    case "likes":
      return deck.likeCount ?? 0;
    case "pokemon":
      return deck.counts?.pokemon ?? 0;
    case "trainer":
      return deck.counts?.trainer ?? 0;
    case "energy":
      return deck.counts?.energy ?? 0;
  }
}

export default function MyDecksClient({ decks }: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("date");
  const [dir, setDir] = useState<SortDir>("desc");

  const filtered = useMemo(() => {
    const q = normalizeForSearch(query.trim());
    const base = q ? decks.filter((d) => normalizeForSearch(d.name).includes(q)) : decks;
    const sorted = [...base].sort((a, b) => {
      const av = sortValue(a, sort);
      const bv = sortValue(b, sort);
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [decks, query, sort, dir]);

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 pt-[calc(env(safe-area-inset-top)_+_1.68rem)] md:pt-[calc(env(safe-area-inset-top)_+_3rem)] pb-24">
      <div className="mb-6">
        <SectionHeader title="Deck Collection" />
      </div>

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
            <option value="date:desc">Date Added (Descending)</option>
            <option value="date:asc">Date Added (Ascending)</option>
            <option value="name:asc">Deck Name (A–Z)</option>
            <option value="name:desc">Deck Name (Z–A)</option>
            <option value="wins:desc">Wins (Descending)</option>
            <option value="wins:asc">Wins (Ascending)</option>
            <option value="likes:desc">Likes (Descending)</option>
            <option value="likes:asc">Likes (Ascending)</option>
            <option value="pokemon:desc">Pokémon Card Count (Descending)</option>
            <option value="pokemon:asc">Pokémon Card Count (Ascending)</option>
            <option value="trainer:desc">Trainer Card Count (Descending)</option>
            <option value="trainer:asc">Trainer Card Count (Ascending)</option>
            <option value="energy:desc">Energy Card Count (Descending)</option>
            <option value="energy:asc">Energy Card Count (Ascending)</option>
          </PillSelect>
          <Link
            href="/"
            className="text-xs font-semibold h-[38px] inline-flex items-center px-3 rounded-full border border-transparent bg-gradient-brand bg-origin-border text-white shadow-brand hover:shadow-brand-lg transition"
          >
            + New Deck
          </Link>
        </div>
      </div>

      {decks.length === 0 ? (
        <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm p-8 text-center">
          <p className="text-sm text-text-secondary">
            No decks yet.{" "}
            <Link href="/" className="text-accent hover:underline">
              Create your first deck profile →
            </Link>
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm p-8 text-center">
          <p className="text-sm text-text-secondary">No decks match “{query}”.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((deck, i) => (
            <UserDeckCard key={deck.id} {...deck} index={i} />
          ))}
        </div>
      )}
    </main>
  );
}
