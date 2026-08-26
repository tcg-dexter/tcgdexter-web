"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PillSelect from "@/app/components/ui/PillSelect";
import GridListToggle from "@/app/components/ui/GridListToggle";
import { FacetGroup } from "@/app/cards/FilterControls";
import { BANNER_ACCENT_KEYS } from "@/app/u/[username]/UserProfileHeader";
import { normalizeForSearch } from "@/lib/searchNormalize";
import { TrainerCard, TrainerRow, type TrainerPreview } from "./TrainerCard";

interface Props {
  trainers: TrainerPreview[];
  /** Anon visitors can't have a follow set, so the Following facet is
   *  hidden rather than shown always-empty. */
  isAuthed: boolean;
}

type SortKey = "likes" | "decks" | "followers" | "name" | "joined";
type SortDir = "asc" | "desc";
type ViewMode = "grid" | "list";

const VIEW_MODE_KEY = "trainersViewMode";
const TOOLBAR_ITEM_HEIGHT = "h-[38px]";

/**
 * Facet chips for the two boolean filters. They ride on `FacetGroup` (the
 * card catalog's chip row) rather than a bespoke control so the panel reads
 * as the same widget on both surfaces — the labels double as the state keys.
 *
 * Why only these three facets: a directory of trainers has very little
 * public surface to slice on. "Has public decks" is the one that matters —
 * a trainer with nothing public is a dead-end link, and hiding them turns
 * the page into a browsable collection index. "Following" turns the same
 * grid into the viewer's own circle. Banner accent is the only attribute a
 * trainer actively picks for themselves, and it mirrors the catalog's
 * Energy facet, so it earns its place as the visual filter. Everything else
 * worth filtering on (battles logged, win rate) is owner-only under RLS —
 * see the note in ./page.tsx.
 */
const FLAG_HAS_DECKS = "Has public decks";
const FLAG_FOLLOWING = "Following";

/** Facet label for a null `banner_accent` — matches the AccentPicker's own
 *  wording for the default brand gradient. */
const ACCENT_SIGNATURE = "Signature";

function sortValue(t: TrainerPreview, key: SortKey): number | string {
  switch (key) {
    case "likes":
      return t.totalLikes;
    case "decks":
      return t.deckCount;
    case "followers":
      return t.followerCount;
    case "name":
      return t.displayName.toLowerCase();
    case "joined":
      return new Date(t.createdAt).getTime();
  }
}

export default function TrainersClient({ trainers, isAuthed }: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("likes");
  const [dir, setDir] = useState<SortDir>("desc");
  const [showFilters, setShowFilters] = useState(false);
  const [flags, setFlags] = useState<string[]>([]);
  const [accents, setAccents] = useState<string[]>([]);
  const [view, setView] = useState<ViewMode>("grid");

  useEffect(() => {
    const stored = window.localStorage.getItem(VIEW_MODE_KEY);
    if (stored === "grid" || stored === "list") setView(stored);
  }, []);

  // Grid and list render different components, so toggling between them
  // remounts the cards — which would replay the entrance fade and read as
  // a page reload. Only the true first paint should animate (same guard as
  // the deck collection).
  const hasAnimatedOnceRef = useRef(false);
  useEffect(() => {
    hasAnimatedOnceRef.current = true;
  }, []);

  function changeView(next: ViewMode) {
    setView(next);
    window.localStorage.setItem(VIEW_MODE_KEY, next);
  }

  const flagOptions = isAuthed ? [FLAG_HAS_DECKS, FLAG_FOLLOWING] : [FLAG_HAS_DECKS];

  // Accent options come from the trainers actually on the page, ordered by
  // the canonical energy order rather than by however the rows arrived —
  // an empty chip that always matches nothing is worse than a short list.
  const accentOptions = useMemo(() => {
    const present = new Set(trainers.map((t) => t.bannerAccent ?? ACCENT_SIGNATURE));
    return [ACCENT_SIGNATURE, ...BANNER_ACCENT_KEYS].filter((a) => present.has(a));
  }, [trainers]);

  const activeFilterCount = flags.length + accents.length;

  function toggle(
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    value: string,
  ) {
    setter((cur) =>
      cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value],
    );
  }

  const filtered = useMemo(() => {
    // Search covers display name and @handle only. Bios are free text and
    // matching them makes the result set feel arbitrary — you'd get hits
    // with no visible reason on the card.
    const q = normalizeForSearch(query.trim());
    let base = q
      ? trainers.filter(
          (t) =>
            normalizeForSearch(t.displayName).includes(q) ||
            normalizeForSearch(t.username).includes(q),
        )
      : trainers;

    if (flags.includes(FLAG_HAS_DECKS)) base = base.filter((t) => t.deckCount > 0);
    if (flags.includes(FLAG_FOLLOWING)) base = base.filter((t) => t.viewerFollows);
    if (accents.length > 0) {
      base = base.filter((t) => accents.includes(t.bannerAccent ?? ACCENT_SIGNATURE));
    }

    return [...base].sort((a, b) => {
      const av = sortValue(a, sort);
      const bv = sortValue(b, sort);
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
      // Stable tiebreak so equal-metric trainers (very common at 0 likes)
      // don't reshuffle between sorts.
      return a.displayName.localeCompare(b.displayName);
    });
  }, [trainers, query, flags, accents, sort, dir]);

  return (
    <>
      {/* Toolbar — same shape as the deck collection's: search fills the
          row, controls sit trailing and wrap to a 2-col grid on mobile. */}
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
            placeholder="Search trainers"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="w-full pl-10 pr-4 py-2 rounded-full border border-black/10 bg-white dark:bg-surface-2 text-[16px] sm:text-sm focus:outline-none focus-gradient-border transition-colors"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
          <PillSelect
            value={`${sort}:${dir}`}
            onChange={(e) => {
              const [s, d] = e.target.value.split(":") as [SortKey, SortDir];
              setSort(s);
              setDir(d);
            }}
          >
            <option value="likes:desc">Likes ↓</option>
            <option value="likes:asc">Likes ↑</option>
            <option value="decks:desc">Public Decks ↓</option>
            <option value="decks:asc">Public Decks ↑</option>
            <option value="followers:desc">Followers ↓</option>
            <option value="followers:asc">Followers ↑</option>
            <option value="name:asc">Trainer Name ↑</option>
            <option value="name:desc">Trainer Name ↓</option>
            <option value="joined:desc">Joined ↓</option>
            <option value="joined:asc">Joined ↑</option>
          </PillSelect>
          <button
            type="button"
            onClick={() => setShowFilters((s) => !s)}
            aria-expanded={showFilters}
            className={`text-xs font-semibold ${TOOLBAR_ITEM_HEIGHT} px-3 rounded-full transition ${
              activeFilterCount > 0
                ? "border border-transparent bg-gradient-brand bg-origin-border text-white shadow-brand hover:shadow-brand-lg"
                : "border border-black/10 bg-white dark:bg-surface-2 hover:bg-surface"
            }`}
          >
            {activeFilterCount > 0 ? "Filtered" : "Filters"}
          </button>
          <GridListToggle value={view} onChange={changeView} className={TOOLBAR_ITEM_HEIGHT} />
        </div>
      </div>

      {showFilters && (
        <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white dark:bg-surface-elevated p-4 mb-4 space-y-4">
          {activeFilterCount > 0 && (
            <div className="pb-3 border-b border-black/8 dark:border-white/10">
              <button
                type="button"
                onClick={() => {
                  setFlags([]);
                  setAccents([]);
                }}
                className="text-xs font-semibold px-3 py-1.5 rounded-full border border-black/10 bg-white dark:bg-surface-2 hover:bg-surface transition-colors"
              >
                Clear all filters
              </button>
            </div>
          )}
          <FacetGroup
            label="Show"
            options={flagOptions}
            selected={flags}
            onToggle={(v) => toggle(setFlags, v)}
          />
          <FacetGroup
            label="Banner accent"
            options={accentOptions}
            selected={accents}
            onToggle={(v) => toggle(setAccents, v)}
          />
        </div>
      )}

      {trainers.length === 0 ? (
        <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm p-8 text-center">
          <p className="text-sm text-text-secondary">
            No public trainer profiles yet.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm p-8 text-center">
          <p className="text-sm text-text-secondary">
            {query.trim()
              ? `No trainers match “${query}”.`
              : "No trainers match these filters."}
          </p>
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-start">
          {filtered.map((t, i) => (
            <TrainerCard
              key={t.id}
              trainer={t}
              index={i}
              skipEntranceAnimation={hasAnimatedOnceRef.current}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm overflow-hidden">
          {filtered.map((t, i) => (
            <TrainerRow key={t.id} trainer={t} isLast={i === filtered.length - 1} />
          ))}
        </div>
      )}
    </>
  );
}
