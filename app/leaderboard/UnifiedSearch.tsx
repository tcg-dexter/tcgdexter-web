"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import archetypesRaw from "@/data/meta-archetypes.json";

interface Archetype {
  id: string;
  name: string;
  top_cut_entries: number;
  representation_pct: number;
}

interface TrainerResult {
  username: string;
  display_name: string;
  avatar_url: string | null;
}

interface DeckResult {
  id: string;
  name: string;
  like_count: number;
  username: string;
  analysis: {
    metaMatch?: { archetypeName?: string | null };
  } | null;
}

interface SearchState {
  trainers: TrainerResult[];
  decks: DeckResult[];
  archetypes: Archetype[];
}

const EMPTY: SearchState = { trainers: [], decks: [], archetypes: [] };

interface Props {
  /**
   * Where the results dropdown should render relative to the input.
   * Default "below" suits the desktop sidebar (search at the top of the
   * rail, plenty of room beneath); the mobile nav panel uses "above"
   * because the search is anchored to the bottom of the panel and the
   * dropdown would otherwise overflow off-screen.
   */
  dropdownPosition?: "below" | "above";
}

export default function UnifiedSearch({ dropdownPosition = "below" }: Props = {}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function search(val: string) {
    if (val.length < 2) {
      setResults(EMPTY);
      setSearched(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    const supabase = createClient();

    // Archetypes: in-memory filter (JSON is already bundled)
    const q = val.toLowerCase();
    const archetypes = (archetypesRaw as Archetype[])
      .filter((a) => a.name.toLowerCase().includes(q))
      .slice(0, 3);

    // Trainers + decks in parallel
    const [{ data: trainers }, { data: rawDecks }] = await Promise.all([
      supabase
        .from("profiles")
        .select("display_name, username, avatar_url")
        .eq("is_public", true)
        .not("username", "is", null)
        .or(`username.ilike.${val.toLowerCase()}%,display_name.ilike.${val}%`)
        .order("display_name")
        .limit(3),
      supabase
        .from("saved_decks")
        .select("id, name, like_count, analysis, user_id")
        .eq("is_public", true)
        .ilike("name", `%${val}%`)
        .order("like_count", { ascending: false })
        .limit(4),
    ]);

    // Resolve usernames for deck results
    let decks: DeckResult[] = [];
    if (rawDecks?.length) {
      const userIds = Array.from(new Set(rawDecks.map((d) => d.user_id)));
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, username")
        .in("id", userIds)
        .eq("is_public", true);
      const profileMap = new Map((profiles ?? []).map((p) => [p.id, p.username]));
      decks = rawDecks
        .map((d) => {
          const username = profileMap.get(d.user_id);
          if (!username) return null;
          return { id: d.id, name: d.name, like_count: d.like_count, analysis: d.analysis, username };
        })
        .filter(Boolean) as DeckResult[];
    }

    setResults({
      trainers: (trainers ?? []) as TrainerResult[],
      decks,
      archetypes,
    });
    setSearched(true);
    setLoading(false);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!val.trim()) {
      setResults(EMPTY);
      setSearched(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => search(val.trim()), 300);
  }

  const hasResults =
    results.trainers.length > 0 ||
    results.decks.length > 0 ||
    results.archetypes.length > 0;

  return (
    <div className="relative">
      <div className="relative">
        <svg
          className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${
            loading ? "animate-pulse text-accent" : "text-text-muted"
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
          />
        </svg>
        <input
          type="text"
          value={query}
          onChange={handleChange}
          // `data-global-search-input` is the hook for the sitewide "/"
          // hotkey wired up by GlobalSearchHotkey at the layout level.
          data-global-search-input
          placeholder="Search [ / ]"
          className="w-full rounded-full border border-black/10 bg-white px-4 py-3 pl-10 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus-gradient-border [font-size:16px] sm:text-sm"
        />
      </div>

      {searched && query.length >= 2 && (
        <div
          className={`absolute left-0 right-0 z-30 rounded-xl border border-black/8 bg-white shadow-lg overflow-hidden ${
            dropdownPosition === "above" ? "bottom-full mb-2" : "top-full mt-2"
          }`}
        >
          {!hasResults ? (
            <p className="px-4 py-3 text-sm text-text-muted">
              No results for &ldquo;{query}&rdquo;
            </p>
          ) : (
            <>
              {results.trainers.length > 0 && (
                <div>
                  <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-text-muted">
                    Trainers
                  </p>
                  {results.trainers.map((t) => {
                    const initial = t.display_name.trim().charAt(0).toUpperCase();
                    return (
                      <Link
                        key={t.username}
                        href={`/u/${t.username}`}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-black/[0.03] transition-colors"
                      >
                        {t.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={t.avatar_url}
                            alt=""
                            className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-surface flex items-center justify-center text-sm font-bold text-text-secondary flex-shrink-0">
                            {initial}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-semibold text-text-primary truncate block">
                            {t.display_name}
                          </span>
                          <span className="text-xs text-text-muted">@{t.username}</span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}

              {results.decks.length > 0 && (
                <div className={results.trainers.length > 0 ? "border-t border-black/5" : ""}>
                  <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-text-muted">
                    Decks
                  </p>
                  {results.decks.map((d) => {
                    const archetype = d.analysis?.metaMatch?.archetypeName ?? null;
                    return (
                      <Link
                        key={d.id}
                        href={`/u/${d.username}/${d.id}`}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-black/[0.03] transition-colors"
                      >
                        <div className="w-8 h-8 rounded-lg bg-surface flex items-center justify-center flex-shrink-0">
                          <svg
                            className="w-4 h-4 text-text-muted"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={1.75}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z"
                            />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-semibold text-text-primary truncate block">
                            {d.name}
                          </span>
                          <span className="text-xs text-text-muted">
                            {archetype ?? "Deck"} · @{d.username}
                          </span>
                        </div>
                        {d.like_count > 0 && (
                          <div className="flex items-center gap-1 text-xs text-text-muted flex-shrink-0">
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                            </svg>
                            {d.like_count}
                          </div>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}

              {results.archetypes.length > 0 && (
                <div
                  className={
                    results.trainers.length > 0 || results.decks.length > 0
                      ? "border-t border-black/5"
                      : ""
                  }
                >
                  <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-text-muted">
                    Meta
                  </p>
                  {results.archetypes.map((a) => (
                    <Link
                      key={a.id}
                      href={`/meta-decks/${a.id}`}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-black/[0.03] transition-colors"
                    >
                      <div className="w-8 h-8 rounded-lg bg-surface flex items-center justify-center flex-shrink-0">
                        <svg
                          className="w-4 h-4 text-text-muted"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={1.75}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
                          />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-semibold text-text-primary truncate block">
                          {a.name}
                        </span>
                        <span className="text-xs text-text-muted">
                          {a.top_cut_entries} top cuts ·{" "}
                          {(a.representation_pct * 100).toFixed(1)}% meta share
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
