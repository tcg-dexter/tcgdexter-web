"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { SetStats } from "@/lib/cardsIndex";
import { normalizeForSearch } from "@/lib/searchNormalize";
import { useInventory } from "./InventoryContext";
import SetLogo from "./SetLogo";
import PillSelect from "@/app/components/ui/PillSelect";
import GridListToggle from "@/app/components/ui/GridListToggle";
import SearchField from "@/app/components/ui/SearchField";

interface DataViewStats {
  uniqueOwnedBySet: Record<string, number>;
}

// Grid pages divide evenly by every column count the layout uses (2/3/4/5/6
// — 5 aside), so the last row doesn't come up short; the list is a single
// column and reads better a little shorter.
const GRID_PAGE_SIZE = 24;
const LIST_PAGE_SIZE = 20;

/** Same column ramp as the card grid, so the two tabs share a rhythm:
 *  2 across on phones, stepping up to 6 on a wide desktop. */
const RESPONSIVE_COLUMNS =
  "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6";

type SetFilter = "all" | "owned" | "unowned";
type SetSortKey = "released" | "name" | "completion";
type SortDir = "asc" | "desc";

export default function DataView({
  setStats,
  onSelectSet,
  view,
  onViewChange,
}: {
  setStats: SetStats[];
  onSelectSet: (setId: string) => void;
  /** Shared with the Cards tab so grid/list is one preference across the
   *  page (and stays in the URL, which is where the catalog keeps it). */
  view: "grid" | "list";
  onViewChange: (view: "grid" | "list") => void;
}) {
  const { signedIn } = useInventory();
  const [stats, setStatsState] = useState<DataViewStats | null>(null);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<SetFilter>("all");
  // Search and sort are local rather than routed through the page's URL
  // params: every set is already in memory here, so filtering needs no
  // round trip — and `q`/`sort` in the URL mean "card search", so reusing
  // them would leave the Cards tab filtered by whatever you typed here.
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SetSortKey>("released");
  const [dir, setDir] = useState<SortDir>("desc");

  useEffect(() => {
    // Reset to the first page whenever the auth state flips so a fresh
    // sign-in lands on the top of the list instead of a stale offset.
    setPage(1);
  }, [signedIn]);

  // Any narrowing or reordering — and a view swap, which changes the page
  // size — can strand `page` past the new last page.
  useEffect(() => {
    setPage(1);
  }, [filter, query, sort, dir, view]);

  useEffect(() => {
    if (signedIn !== true) {
      setStatsState(null);
      return;
    }
    let cancelled = false;
    fetch("/api/collection/data-view")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load stats"))))
      .then((data: DataViewStats) => {
        if (cancelled) return;
        setStatsState(data);
      })
      .catch(() => {
        if (cancelled) return;
        setStatsState(null);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  const ownedBySet = stats?.uniqueOwnedBySet ?? {};

  const visibleSets = useMemo(() => {
    const owned = stats?.uniqueOwnedBySet ?? {};

    let out = setStats;
    if (filter === "owned") out = out.filter((s) => (owned[s.id] ?? 0) > 0);
    else if (filter === "unowned") out = out.filter((s) => (owned[s.id] ?? 0) === 0);

    const q = normalizeForSearch(query.trim());
    if (q) {
      out = out.filter(
        (s) =>
          normalizeForSearch(s.name).includes(q) ||
          normalizeForSearch(s.ptcgoCode ?? "").includes(q),
      );
    }

    const completion = (s: SetStats) =>
      s.size > 0 ? (owned[s.id] ?? 0) / s.size : 0;
    const sign = dir === "asc" ? 1 : -1;
    return [...out].sort((a, b) => {
      let cmp: number;
      if (sort === "name") cmp = a.name.localeCompare(b.name);
      else if (sort === "completion") cmp = completion(a) - completion(b);
      else cmp = (a.releaseDate ?? "").localeCompare(b.releaseDate ?? "");
      // Ties fall back to name so the order is stable rather than
      // whatever the previous sort happened to leave behind — which
      // matters most for completion, where signed-out is all zeroes.
      return cmp !== 0 ? cmp * sign : a.name.localeCompare(b.name);
    });
  }, [setStats, filter, stats, query, sort, dir]);

  const pageSize = view === "grid" ? GRID_PAGE_SIZE : LIST_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(visibleSets.length / pageSize));
  const pageSets = useMemo(() => {
    const start = (page - 1) * pageSize;
    return visibleSets.slice(start, start + pageSize);
  }, [visibleSets, page, pageSize]);

  return (
    <div className="flex flex-col gap-6">
      {signedIn === false && (
        <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white dark:bg-surface-elevated p-6 text-center">
          <p className="text-sm text-text-secondary">
            <Link href="/sign-in" className="font-semibold text-accent hover:underline">
              Sign in
            </Link>{" "}
            to track your collection and see completion progress across every set.
          </p>
        </div>
      )}

      <div>
        {/* Toolbar — mirrors the Cards tab's search / sort / view row. */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search sets"
          />
          <div className="flex items-center gap-2">
            <PillSelect
              value={`${sort}:${dir}`}
              onChange={(e) => {
                const [s, d] = e.target.value.split(":") as [SetSortKey, SortDir];
                setSort(s);
                setDir(d);
              }}
            >
              <option value="released:desc">Released ↓</option>
              <option value="released:asc">Released ↑</option>
              <option value="name:asc">Set Name ↑</option>
              <option value="name:desc">Set Name ↓</option>
              <option value="completion:desc">Completion ↓</option>
              <option value="completion:asc">Completion ↑</option>
            </PillSelect>
            <GridListToggle value={view} onChange={onViewChange} />
          </div>
        </div>

        <SetFilterRadios value={filter} onChange={setFilter} disabled={signedIn !== true} />
        {pageSets.length === 0 ? (
          <p className="text-sm text-text-secondary py-4">No sets match this filter.</p>
        ) : view === "grid" ? (
          <div className={`grid ${RESPONSIVE_COLUMNS} gap-3`}>
            {pageSets.map((s) => (
              <SetCompletionTile
                key={s.id}
                set={s}
                owned={ownedBySet[s.id] ?? 0}
                onSelect={onSelectSet}
              />
            ))}
          </div>
        ) : (
          <ul>
            {pageSets.map((s, i) => (
              <SetCompletionRow
                key={s.id}
                set={s}
                owned={ownedBySet[s.id] ?? 0}
                isFirst={i === 0}
                onSelect={onSelectSet}
              />
            ))}
          </ul>
        )}
      </div>

      {totalPages > 1 && (
        <SetPagination page={page} totalPages={totalPages} onPage={setPage} />
      )}
    </div>
  );
}

function SetFilterRadios({
  value,
  onChange,
  disabled,
}: {
  value: SetFilter;
  onChange: (v: SetFilter) => void;
  disabled: boolean;
}) {
  const options: Array<{ key: SetFilter; label: string }> = [
    { key: "all", label: "All Sets" },
    { key: "owned", label: "Owned" },
    { key: "unowned", label: "Unowned" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Set ownership scope"
      className="flex items-center gap-4 mb-3"
    >
      {options.map((o) => {
        const selected = value === o.key;
        const isDisabled = disabled && o.key !== "all";
        return (
          <label
            key={o.key}
            className={`inline-flex items-center gap-2 select-none text-xs font-medium text-text-secondary ${
              isDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
            }`}
          >
            <input
              type="radio"
              name="set-filter"
              value={o.key}
              checked={selected}
              disabled={isDisabled}
              onChange={() => onChange(o.key)}
              className="sr-only peer"
            />
            <span
              aria-hidden="true"
              className={`relative inline-flex h-4 w-4 items-center justify-center rounded-full border transition-colors ${
                selected
                  ? "border-accent bg-white dark:bg-surface-elevated"
                  : "border-black/25 dark:border-white/25 bg-white dark:bg-surface-elevated peer-hover:border-black/50 dark:peer-hover:border-white/50"
              }`}
            >
              {selected && <span className="h-2 w-2 rounded-full bg-accent" />}
            </span>
            <span className={selected ? "text-text-primary" : ""}>{o.label}</span>
          </label>
        );
      })}
    </div>
  );
}

/** Completion percentage for a set, clamped so an over-held set (catalog
 *  ahead of the totals file) can't run the bar past its track. */
function completionPct(set: SetStats, owned: number): number {
  return set.size > 0 ? Math.min(100, (owned / set.size) * 100) : 0;
}

/**
 * The completion bar, shared by the list row and the grid tile so the
 * gradient trick below only lives in one place.
 */
function SetProgressBar({ set, pct }: { set: SetStats; pct: number }) {
  return (
    <div
      className="h-2 rounded-full bg-surface"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={`${set.name} completion ${pct.toFixed(0)}%`}
    >
      <div
        className="h-full rounded-full bg-gradient-brand transition-[width] duration-500"
        style={{
          width: `${pct}%`,
          // Stretch the gradient so its full extent always spans the
          // entire track. The fill div only paints the leftmost
          // `pct%` of it, so the colour at the leading edge
          // progresses smoothly from orange toward dark red as the
          // bar grows — the visible gradient is the proportional
          // metaphor, not a uniformly-coloured chunk.
          backgroundSize: pct > 0 ? `${10000 / pct}% 100%` : "100% 100%",
          backgroundPosition: "left center",
        }}
      />
    </div>
  );
}

/** How long the pointer has to rest on a tile before its logo shimmers. */
const SHEEN_DWELL_MS = 1000;

/**
 * Hover lifts the tile a touch and firms up its border. `relative` +
 * hover:z-10 keeps the growing tile above its later siblings, which would
 * otherwise paint over the 2px it gains on each side. The transition names
 * its properties rather than using transition-all, so the progress bar's
 * own width animation isn't swept into it.
 */
const TILE_CLS =
  "relative flex flex-col text-left rounded-xl border border-black/8 " +
  "dark:border-white/10 bg-white dark:bg-surface-elevated overflow-hidden " +
  "hover:z-10 hover:scale-[1.02] hover:border-black/20 " +
  "dark:hover:border-white/25 hover:shadow-md motion-reduce:hover:scale-100 " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
  "transition-[transform,border-color,box-shadow] duration-200 ease-out";

/**
 * Grid presentation of a set: the logo front and centre, then a footer of
 * two rows — name and release date, then the completion bar. The exact
 * counts stay on the list view, which has the width for them; here the
 * numbers live in the bar's aria-label and the tile's title.
 */
function SetCompletionTile({
  set,
  owned,
  onSelect,
}: {
  set: SetStats;
  owned: number;
  onSelect: (setId: string) => void;
}) {
  const pct = completionPct(set, owned);
  const released = formatReleaseDate(set.releaseDate, "short");

  // The sheen is a reward for dwelling, not a response to the pointer
  // crossing the tile — at a second in, a passing sweep of the grid never
  // sets one off. Cleared on leave so an interrupted dwell doesn't fire
  // late, and unmounted when the sweep ends so the next hover re-arms it.
  const [sheen, setSheen] = useState(false);
  const dwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function cancelDwell() {
    if (dwellTimer.current) clearTimeout(dwellTimer.current);
    dwellTimer.current = null;
  }
  useEffect(() => cancelDwell, []);

  return (
    <button
      type="button"
      onClick={() => onSelect(set.id)}
      onPointerEnter={(e) => {
        // Touch fires enter on tap and never leaves, which would strand a
        // sheen on the tile after navigating away.
        if (e.pointerType === "touch") return;
        cancelDwell();
        dwellTimer.current = setTimeout(() => setSheen(true), SHEEN_DWELL_MS);
      }}
      onPointerLeave={() => {
        cancelDwell();
        setSheen(false);
      }}
      aria-label={`Filter catalog by ${set.name}`}
      title={`${set.name} — ${owned} / ${set.size}`}
      className={TILE_CLS}
    >
      {/* flex-1 lets the logo well absorb the extra height when a taller
          tile in the same grid row stretches this one, so every footer in
          the row still lines up along the bottom. */}
      <div className="relative flex flex-1 items-center justify-center px-4 py-5">
        <SetLogo
          src={set.logo}
          ptcgoCode={set.ptcgoCode}
          setName={set.name}
          className="h-16 w-full"
        />
        {sheen && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden"
            style={{ mixBlendMode: "overlay" }}
          >
            <span
              className="dx-foil-sweep absolute inset-y-0"
              onAnimationEnd={() => setSheen(false)}
            />
          </span>
        )}
      </div>
      <div className="px-3 pb-3">
        {/* Name over date, centred under the logo. On one row the date ate
            enough width to truncate most set names; stacked, the name gets
            the full tile. */}
        <div className="flex flex-col items-center text-center mb-2">
          <span className="max-w-full truncate text-[13px] font-semibold text-text-primary">
            {set.name}
          </span>
          {released && (
            <span className="text-[11px] text-text-muted tabular-nums">
              {released}
            </span>
          )}
        </div>
        <SetProgressBar set={set} pct={pct} />
      </div>
    </button>
  );
}

function SetCompletionRow({
  set,
  owned,
  isFirst,
  onSelect,
}: {
  set: SetStats;
  owned: number;
  isFirst: boolean;
  onSelect: (setId: string) => void;
}) {
  const pct = completionPct(set, owned);
  const released = formatReleaseDate(set.releaseDate);
  const missing = Math.max(0, set.size - set.held);
  return (
    <li className="py-3">
      <button
        type="button"
        onClick={() => onSelect(set.id)}
        aria-label={`Filter catalog by ${set.name}`}
        className="w-full text-left flex items-center gap-3 rounded-lg -mx-2 px-2 py-1 hover:bg-surface/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors"
      >
        <SetLogo
          src={set.logo}
          ptcgoCode={set.ptcgoCode}
          setName={set.name}
          className="shrink-0 w-16 h-12"
        />
        <div className="min-w-0 flex-1 relative">
          {!isFirst && (
            // The row uses items-center, so this hairline lives at the
            // top of the text column — which equals the row's top edge,
            // since the text column is the taller flex child. Backing
            // up by py-3 puts the line in the visual midline between
            // adjacent rows. It only spans the text column, leaving
            // the logo column undivided as requested.
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -top-3 inset-x-0 h-px bg-black/8 dark:bg-white/8"
            />
          )}
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-text-primary truncate">
                {set.name}
              </div>
              {released && (
                <div className="text-xs text-text-muted truncate">{released}</div>
              )}
              {missing > 0 && (
                // The denominator is the set's real size, so a set we haven't
                // fully ingested can't reach 100%. Say why rather than letting
                // it look like the collection is short.
                <div className="text-xs text-text-muted truncate">
                  {missing} not yet in catalog
                </div>
              )}
            </div>
            <div className="flex flex-col items-end tabular-nums whitespace-nowrap leading-tight">
              <span className="text-sm font-semibold text-text-primary">
                {pct.toFixed(0)}%
              </span>
              <span className="text-xs font-medium text-text-secondary">
                {owned} / {set.size}
              </span>
            </div>
          </div>
          <SetProgressBar set={set} pct={pct} />
        </div>
      </button>
    </li>
  );
}

function SetPagination({
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
    <div className="flex items-center justify-between gap-2">
      <button
        onClick={() => onPage(page - 1)}
        disabled={!canPrev}
        className="text-xs font-semibold px-3 py-1.5 rounded-full border border-black/10 bg-white dark:bg-surface-2 disabled:opacity-40 hover:bg-surface transition-colors"
      >
        ← Prev
      </button>
      <span className="text-xs text-text-secondary">
        Page {page} of {totalPages}
      </span>
      <button
        onClick={() => onPage(page + 1)}
        disabled={!canNext}
        className="text-xs font-semibold px-3 py-1.5 rounded-full border border-black/10 bg-white dark:bg-surface-2 disabled:opacity-40 hover:bg-surface transition-colors"
      >
        Next →
      </button>
    </div>
  );
}

function formatReleaseDate(
  d: string | null,
  style: "long" | "short" = "long",
): string {
  if (!d) return "";
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString(
    "en-US",
    style === "short"
      ? { year: "numeric", month: "short" }
      : { year: "numeric", month: "short", day: "numeric" },
  );
}
