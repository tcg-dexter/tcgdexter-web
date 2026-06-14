"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { SetStats } from "@/lib/cardsIndex";
import { useInventory } from "./InventoryContext";
import SetLogo from "./SetLogo";

interface DataViewStats {
  cardCount: number;
  marketValue: number;
  uniqueOwnedBySet: Record<string, number>;
}

const PAGE_SIZE = 20;

type SetFilter = "all" | "owned" | "unowned";

export default function DataView({ setStats }: { setStats: SetStats[] }) {
  const { signedIn } = useInventory();
  const [stats, setStatsState] = useState<StatsState>({
    loading: false,
    data: null,
  });
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<SetFilter>("all");

  useEffect(() => {
    // Reset to the first page whenever the auth state flips so a fresh
    // sign-in lands on the top of the list instead of a stale offset.
    setPage(1);
  }, [signedIn]);

  useEffect(() => {
    setPage(1);
  }, [filter]);

  useEffect(() => {
    if (signedIn !== true) {
      setStatsState({ loading: false, data: null });
      return;
    }
    let cancelled = false;
    setStatsState({ loading: true, data: null });
    fetch("/api/collection/data-view")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load stats"))))
      .then((data: DataViewStats) => {
        if (cancelled) return;
        setStatsState({ loading: false, data });
      })
      .catch(() => {
        if (cancelled) return;
        setStatsState({ loading: false, data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  const filteredSets = useMemo(() => {
    if (filter === "all") return setStats;
    const owned = stats.data?.uniqueOwnedBySet ?? {};
    if (filter === "owned") {
      return setStats.filter((s) => (owned[s.id] ?? 0) > 0);
    }
    return setStats.filter((s) => (owned[s.id] ?? 0) === 0);
  }, [setStats, filter, stats.data]);

  const totalPages = Math.max(1, Math.ceil(filteredSets.length / PAGE_SIZE));
  const pageSets = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredSets.slice(start, start + PAGE_SIZE);
  }, [filteredSets, page]);

  return (
    <div className="flex flex-col gap-6">
      <StatRow
        cardCount={stats.data?.cardCount ?? 0}
        marketValue={stats.data?.marketValue ?? 0}
        loading={stats.loading}
        signedIn={signedIn}
      />

      {signedIn === false && (
        <div className="rounded-2xl border border-black/8 bg-white p-6 text-center">
          <p className="text-sm text-text-secondary">
            <Link href="/sign-in" className="font-semibold text-accent hover:underline">
              Sign in
            </Link>{" "}
            to track your collection and see completion progress across every set.
          </p>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="text-sm font-semibold text-text-primary">Sets</h3>
          <span className="text-xs text-text-muted">
            {filteredSets.length} {filteredSets.length === 1 ? "set" : "sets"} · newest first
          </span>
        </div>
        <SetFilterRadios value={filter} onChange={setFilter} disabled={signedIn !== true} />
        {pageSets.length === 0 ? (
          <p className="text-sm text-text-secondary py-4">No sets match this filter.</p>
        ) : (
          <ul>
            {pageSets.map((s, i) => {
              const owned = stats.data?.uniqueOwnedBySet[s.id] ?? 0;
              return (
                <SetCompletionRow
                  key={s.id}
                  set={s}
                  owned={owned}
                  isFirst={i === 0}
                />
              );
            })}
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
                  ? "border-accent bg-white"
                  : "border-black/25 bg-white peer-hover:border-black/50"
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

function StatRow({
  cardCount,
  marketValue,
  loading,
  signedIn,
}: {
  cardCount: number;
  marketValue: number;
  loading: boolean;
  signedIn: boolean | null;
}) {
  const showValues = signedIn === true && !loading;
  return (
    <div className="grid grid-cols-2 gap-3">
      <StatCard
        label="Cards in Collection"
        value={showValues ? cardCount.toLocaleString() : "—"}
      />
      <StatCard
        label="Total Market Value"
        value={showValues ? formatCurrency(marketValue) : "—"}
      />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-black/8 bg-white p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-text-primary tabular-nums text-right">
        {value}
      </div>
    </div>
  );
}

function SetCompletionRow({
  set,
  owned,
  isFirst,
}: {
  set: SetStats;
  owned: number;
  isFirst: boolean;
}) {
  const pct = set.size > 0 ? Math.min(100, (owned / set.size) * 100) : 0;
  const released = formatReleaseDate(set.releaseDate);
  return (
    <li className="py-3">
      <div className="flex items-center gap-3">
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
              className="pointer-events-none absolute -top-3 inset-x-0 h-px bg-black/8"
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
            </div>
            <span className="text-xs font-semibold text-text-secondary tabular-nums whitespace-nowrap pt-0.5">
              {owned} / {set.size}
              <span className="ml-2 text-text-muted">({pct.toFixed(0)}%)</span>
            </span>
          </div>
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
        </div>
      </div>
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

function formatCurrency(n: number): string {
  if (n >= 1000) return `$${Math.round(n).toLocaleString()}`;
  return `$${n.toFixed(2)}`;
}

function formatReleaseDate(d: string | null): string {
  if (!d) return "";
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

interface StatsState {
  loading: boolean;
  data: DataViewStats | null;
}
