"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SectionHeader from "@/app/components/ui/SectionHeader";
import PillSelect from "@/app/components/ui/PillSelect";
import { UserDeckCard, type UserDeckCardProps } from "@/app/components/DeckPostCard";
import QRCodeButton from "@/app/components/QRCodeButton";
import MatchForm, { type MatchFormData } from "@/app/components/MatchForm";
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
type ViewMode = "grid" | "list";

const VIEW_MODE_KEY = "myDecksViewMode";
const MIN_MATCHES_FOR_HERO = 3;
const TOOLBAR_ITEM_HEIGHT = "h-[38px]";

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

function PinIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 21s7-7.5 7-12a7 7 0 1 0-14 0c0 4.5 7 12 7 12z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  );
}

function PinnedDeckHero({ deck }: { deck: UserDeckCardProps }) {
  const router = useRouter();
  const [logOpen, setLogOpen] = useState(false);
  const wl = deck.wl;
  const hasRecord = !!wl && wl.w + wl.l + wl.d > 0;
  const streak = currentStreak(wl?.recentForm);

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
    setLogOpen(false);
    router.refresh();
  }

  const capsuleBase =
    "inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-[13px] font-semibold transition-colors";

  return (
    <div className="relative rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm overflow-hidden flex flex-col md:flex-row mb-4">
      <div className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-white shadow-sm flex items-center justify-center text-accent">
        <PinIcon className="w-4 h-4" />
      </div>

      <div
        className="relative h-[170px] md:h-auto md:w-[360px] shrink-0 overflow-hidden"
        style={{ background: "linear-gradient(120deg, #2c2440 0%, #4b3a72 100%)" }}
      >
        <div
          className="absolute rounded-lg overflow-hidden bg-white shadow-[0_16px_34px_rgba(0,0,0,0.35)]"
          style={{ width: 130, height: 180, left: "45%", top: "50%", transform: "translate(-50%,-56%) rotate(-4deg)" }}
        >
          {deck.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={deck.imageUrl} alt={deck.name} className="w-full h-full object-cover" />
          ) : null}
        </div>
      </div>
      <div className="flex-1 p-5 md:p-6">
        <Link href={deck.href} className="block text-[26px] font-bold text-text-primary hover:underline underline-offset-2 leading-tight">
          {deck.name}
        </Link>
        <p className="text-[13.5px] text-text-secondary mt-1">
          {[deck.archetypeName, deck.legalityReady === false ? "Rotating" : "Standard legal", deck.price != null ? `$${deck.price.toFixed(2)} market` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>

        {hasRecord ? (
          <div className="flex flex-wrap gap-x-9 gap-y-3 mt-4">
            <div>
              <div className="text-[24px] font-extrabold tabular-nums text-text-primary">{wl!.w}–{wl!.l}</div>
              <div className="text-[11px] font-bold uppercase tracking-[0.09em] text-text-muted">Record</div>
            </div>
            <div>
              <div className="text-[24px] font-extrabold tabular-nums text-[#127a3c]">{wl!.winRatePct}%</div>
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
        ) : (
          <p className="text-[13px] font-semibold text-text-muted mt-4">No matches logged yet</p>
        )}

        <div className="flex flex-wrap gap-2 mt-5">
          <button
            type="button"
            onClick={() => setLogOpen((v) => !v)}
            className={`${capsuleBase} bg-black text-white`}
          >
            Log match
          </button>
          <QRCodeButton shareUrl={deck.href} className={`${capsuleBase} border border-black/10 bg-white text-text-primary hover:bg-black/[0.03]`} />
          <Link href={deck.href} className={`${capsuleBase} bg-accent text-white`}>
            View deck
          </Link>
        </div>

        {logOpen && (
          <div className="mt-4 max-w-sm">
            <MatchForm compact onSubmit={handleQuickLog} onCancel={() => setLogOpen(false)} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function MyDecksClient({ decks }: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("date");
  const [dir, setDir] = useState<SortDir>("desc");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [view, setView] = useState<ViewMode>("grid");

  useEffect(() => {
    const stored = window.localStorage.getItem(VIEW_MODE_KEY);
    if (stored === "grid" || stored === "list") setView(stored);
  }, []);

  function changeView(next: ViewMode) {
    setView(next);
    window.localStorage.setItem(VIEW_MODE_KEY, next);
  }

  // The hero always shows exactly one deck once the collection is non-empty:
  // the user's explicit pin, else the winningest deck (min match threshold
  // so a 1-0 fluke can't dominate), else simply the first deck.
  const pinnedDeck = useMemo(() => {
    if (decks.length === 0) return null;
    const pinned = decks.find((d) => d.isPinned);
    if (pinned) return pinned;
    const qualifying = decks.filter((d) => d.wl && d.wl.w + d.wl.l >= MIN_MATCHES_FOR_HERO);
    if (qualifying.length > 0) {
      return qualifying.reduce((best, d) => {
        const bestPct = best.wl?.winRatePct ?? -1;
        const dPct = d.wl?.winRatePct ?? -1;
        if (dPct !== bestPct) return dPct > bestPct ? d : best;
        const bestGames = (best.wl?.w ?? 0) + (best.wl?.l ?? 0);
        const dGames = (d.wl?.w ?? 0) + (d.wl?.l ?? 0);
        return dGames > bestGames ? d : best;
      });
    }
    return decks[0];
  }, [decks]);

  const filtered = useMemo(() => {
    const q = normalizeForSearch(query.trim());
    let base = q ? decks.filter((d) => normalizeForSearch(d.name).includes(q)) : decks;
    if (favoritesOnly) base = base.filter((d) => d.isFavorite);
    const sorted = [...base].sort((a, b) => {
      const av = sortValue(a, sort);
      const bv = sortValue(b, sort);
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [decks, query, sort, dir, favoritesOnly]);

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 pt-[calc(env(safe-area-inset-top)_+_1.68rem)] md:pt-[calc(env(safe-area-inset-top)_+_3rem)] pb-24">
      <div className="mb-6">
        <SectionHeader title="Deck Collection" />
      </div>

      {pinnedDeck && <PinnedDeckHero deck={pinnedDeck} />}

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
          <div className={`flex items-center ${TOOLBAR_ITEM_HEIGHT} rounded-full bg-black/5 p-[3px]`}>
            <button
              onClick={() => changeView("grid")}
              className={`h-full flex items-center px-3.5 rounded-full text-xs font-bold transition-colors ${view === "grid" ? "bg-white text-text-primary shadow-sm" : "text-text-muted"}`}
            >
              Grid
            </button>
            <button
              onClick={() => changeView("list")}
              className={`h-full flex items-center px-3.5 rounded-full text-xs font-bold transition-colors ${view === "list" ? "bg-white text-text-primary shadow-sm" : "text-text-muted"}`}
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
          <button
            type="button"
            onClick={() => setFavoritesOnly((v) => !v)}
            aria-pressed={favoritesOnly}
            title={favoritesOnly ? "Showing favorites only" : "Show favorites only"}
            className={`${TOOLBAR_ITEM_HEIGHT} inline-flex items-center gap-1.5 px-3 rounded-full text-xs font-semibold transition-colors ${
              favoritesOnly ? "bg-black text-white" : "bg-white text-text-secondary border border-black/8"
            }`}
          >
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill={favoritesOnly ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
            Favorites
          </button>
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
