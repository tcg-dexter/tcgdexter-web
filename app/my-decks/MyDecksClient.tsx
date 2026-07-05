"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import SectionHeader from "@/app/components/ui/SectionHeader";
import PillSelect from "@/app/components/ui/PillSelect";
import { UserDeckCard, type UserDeckCardProps } from "@/app/components/DeckPostCard";
import SavedDeckRow from "./SavedDeckRow";
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
type FilterKey = "all" | "favorites" | "standard";
type ViewMode = "grid" | "list";

const VIEW_MODE_KEY = "myDecksViewMode";
const MIN_MATCHES_FOR_HERO = 3;

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

/** Longest active streak from the front of a newest-first W/L/D sequence,
 *  e.g. ["W","W","L",...] -> "W2". Null when there's no form yet. */
function currentStreak(recentForm?: ("W" | "L" | "D")[]): string | null {
  if (!recentForm || recentForm.length === 0) return null;
  const first = recentForm[0];
  let count = 0;
  for (const r of recentForm) {
    if (r !== first) break;
    count++;
  }
  return `${first}${count}`;
}

function TopPerformerHero({ deck }: { deck: UserDeckCardProps }) {
  const wl = deck.wl;
  const streak = currentStreak(wl?.recentForm);
  return (
    <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm overflow-hidden flex flex-col md:flex-row mb-4">
      <div
        className="relative h-[170px] md:h-auto md:w-[360px] shrink-0 overflow-hidden"
        style={{ background: "linear-gradient(120deg, #2c2440 0%, #4b3a72 100%)" }}
      >
        <div
          className="absolute rounded-lg overflow-hidden border-[6px] border-[#f5d34c] bg-white shadow-[0_16px_34px_rgba(0,0,0,0.35)]"
          style={{ width: 130, height: 180, left: "45%", top: "50%", transform: "translate(-50%,-56%) rotate(-4deg)" }}
        >
          {deck.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={deck.imageUrl} alt={deck.name} className="w-full h-full object-cover" />
          ) : null}
        </div>
      </div>
      <div className="flex-1 p-5 md:p-6">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fdeeee] px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.08em] text-[#c03434]">
          ★ Top performer
        </span>
        <Link href={deck.href} className="block mt-2.5 text-[26px] font-bold text-text-primary hover:underline underline-offset-2 leading-tight">
          {deck.name}
        </Link>
        <p className="text-[13.5px] text-text-secondary mt-1">
          {[deck.archetypeName, deck.legalityReady === false ? "Rotating" : "Standard legal", deck.price != null ? `$${deck.price.toFixed(2)} market` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>

        <div className="flex flex-wrap gap-x-9 gap-y-3 mt-4">
          <div>
            <div className="text-[24px] font-extrabold tabular-nums text-text-primary">{wl?.w}–{wl?.l}</div>
            <div className="text-[11px] font-bold uppercase tracking-[0.09em] text-text-muted">Record</div>
          </div>
          <div>
            <div className="text-[24px] font-extrabold tabular-nums text-[#127a3c]">{wl?.winRatePct}%</div>
            <div className="text-[11px] font-bold uppercase tracking-[0.09em] text-text-muted">Win rate</div>
          </div>
          {streak && (
            <div>
              <div className="text-[24px] font-extrabold tabular-nums text-text-primary">{streak}</div>
              <div className="text-[11px] font-bold uppercase tracking-[0.09em] text-text-muted">Streak</div>
            </div>
          )}
          {wl?.recentForm && wl.recentForm.length > 0 && (
            <div>
              <div className="flex gap-1">
                {wl.recentForm.map((r, i) => (
                  <span
                    key={i}
                    className={`w-[22px] h-[22px] rounded-[6px] text-[10.5px] font-extrabold flex items-center justify-center ${
                      r === "W" ? "bg-[#e7f4eb] text-[#127a3c]" : r === "L" ? "bg-[#fdeeee] text-[#c03434]" : "bg-black/5 text-text-muted"
                    }`}
                  >
                    {r}
                  </span>
                ))}
              </div>
              <div className="text-[11px] font-bold uppercase tracking-[0.09em] text-text-muted mt-1.5">Recent form</div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mt-5">
          <Link href={deck.href} className="rounded-xl border border-transparent bg-black px-4 py-2.5 text-[13px] font-semibold text-white">
            Open deck
          </Link>
          {deck.archetypeId && (
            <Link
              href={`/meta-archetypes/${deck.archetypeId}`}
              className="rounded-xl border border-transparent bg-accent px-4 py-2.5 text-[13px] font-semibold text-white"
            >
              Compare vs meta
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MyDecksClient({ decks }: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("date");
  const [dir, setDir] = useState<SortDir>("desc");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [view, setView] = useState<ViewMode>("grid");

  useEffect(() => {
    const stored = window.localStorage.getItem(VIEW_MODE_KEY);
    if (stored === "grid" || stored === "list") setView(stored);
  }, []);

  function changeView(next: ViewMode) {
    setView(next);
    window.localStorage.setItem(VIEW_MODE_KEY, next);
  }

  const topPerformer = useMemo(() => {
    const qualifying = decks.filter((d) => d.wl && d.wl.w + d.wl.l >= MIN_MATCHES_FOR_HERO);
    if (qualifying.length === 0) return null;
    return qualifying.reduce((best, d) => {
      const bestPct = best.wl?.winRatePct ?? -1;
      const dPct = d.wl?.winRatePct ?? -1;
      if (dPct !== bestPct) return dPct > bestPct ? d : best;
      const bestGames = (best.wl?.w ?? 0) + (best.wl?.l ?? 0);
      const dGames = (d.wl?.w ?? 0) + (d.wl?.l ?? 0);
      return dGames > bestGames ? d : best;
    });
  }, [decks]);

  const filtered = useMemo(() => {
    const q = normalizeForSearch(query.trim());
    let base = q ? decks.filter((d) => normalizeForSearch(d.name).includes(q)) : decks;
    if (filter === "favorites") base = base.filter((d) => d.isFavorite);
    else if (filter === "standard") base = base.filter((d) => d.legalityReady !== false);
    const sorted = [...base].sort((a, b) => {
      const av = sortValue(a, sort);
      const bv = sortValue(b, sort);
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [decks, query, sort, dir, filter]);

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 pt-[calc(env(safe-area-inset-top)_+_1.68rem)] md:pt-[calc(env(safe-area-inset-top)_+_3rem)] pb-24">
      <div className="mb-6">
        <SectionHeader title="Deck Collection" />
      </div>

      {topPerformer ? (
        <TopPerformerHero deck={topPerformer} />
      ) : decks.length > 0 ? (
        <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm p-5 text-center mb-4">
          <p className="text-sm text-text-secondary">
            Log a few matches to crown a top performer — decks need at least {MIN_MATCHES_FOR_HERO} decisive games to qualify.
          </p>
        </div>
      ) : null}

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
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
          <div className="flex rounded-full bg-black/5 p-[3px]">
            <button
              onClick={() => changeView("grid")}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors ${view === "grid" ? "bg-white text-text-primary shadow-sm" : "text-text-muted"}`}
            >
              Grid
            </button>
            <button
              onClick={() => changeView("list")}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors ${view === "list" ? "bg-white text-text-primary shadow-sm" : "text-text-muted"}`}
            >
              List
            </button>
          </div>
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

      {/* Filter chips */}
      <div className="flex items-center gap-2 mb-4">
        {([
          ["all", "All decks"],
          ["favorites", "♥ Favorites"],
          ["standard", "Standard-legal"],
        ] as [FilterKey, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              filter === key ? "bg-black text-white" : "bg-white text-text-secondary border border-black/8"
            }`}
          >
            {label}
          </button>
        ))}
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
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((deck, i) => (
            <UserDeckCard key={deck.id} {...deck} index={i} />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm overflow-hidden">
          {filtered.map((deck, i) => (
            <SavedDeckRow key={deck.id} {...deck} isLast={i === filtered.length - 1} />
          ))}
        </div>
      )}
    </main>
  );
}
