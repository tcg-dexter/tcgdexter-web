"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import SectionHeader from "@/app/components/ui/SectionHeader";
import { UserDeckCard, type UserDeckCardProps } from "@/app/components/DeckPostCard";

interface Props {
  decks: UserDeckCardProps[];
}

export default function MyDecksClient({ decks }: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return decks;
    return decks.filter((d) => d.name.toLowerCase().includes(q));
  }, [decks, query]);

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 pt-[calc(env(safe-area-inset-top)_+_1.68rem)] md:pt-[calc(env(safe-area-inset-top)_+_3rem)] pb-24">
      <div className="mb-6">
        <SectionHeader eyebrow="Your library" title="My Decks" />
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
            className="w-full pl-10 pr-4 py-2 rounded-full border border-black/10 bg-white text-sm focus:outline-none focus:border-accent transition-colors"
          />
        </div>
        <div className="flex items-center gap-2">
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
          {filtered.map((deck) => (
            <UserDeckCard key={deck.id} {...deck} />
          ))}
        </div>
      )}
    </main>
  );
}
