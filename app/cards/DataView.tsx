"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { SetStats } from "@/lib/cardsIndex";
import { useInventory } from "./InventoryContext";

interface DataViewStats {
  cardCount: number;
  marketValue: number;
  uniqueOwnedBySet: Record<string, number>;
}

const PAGE_SIZE = 20;

export default function DataView({ setStats }: { setStats: SetStats[] }) {
  const { signedIn } = useInventory();
  const [stats, setStatsState] = useState<StatsState>({
    loading: false,
    data: null,
  });
  const [page, setPage] = useState(1);

  useEffect(() => {
    // Reset to the first page whenever the auth state flips so a fresh
    // sign-in lands on the top of the list instead of a stale offset.
    setPage(1);
  }, [signedIn]);

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

  const uniqueSetsOwned = useMemo(() => {
    if (!stats.data) return 0;
    return Object.keys(stats.data.uniqueOwnedBySet).length;
  }, [stats.data]);

  const totalPages = Math.max(1, Math.ceil(setStats.length / PAGE_SIZE));
  const pageSets = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return setStats.slice(start, start + PAGE_SIZE);
  }, [setStats, page]);

  return (
    <div className="flex flex-col gap-6">
      <StatRow
        cardCount={stats.data?.cardCount ?? 0}
        marketValue={stats.data?.marketValue ?? 0}
        uniqueSetsOwned={uniqueSetsOwned}
        totalSets={setStats.length}
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

      <div className="rounded-2xl border border-black/8 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-black/8 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-primary">Set Completion</h3>
          <span className="text-xs text-text-muted">
            {setStats.length} sets · newest first
          </span>
        </div>
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
      </div>

      {totalPages > 1 && (
        <SetPagination page={page} totalPages={totalPages} onPage={setPage} />
      )}
    </div>
  );
}

function StatRow({
  cardCount,
  marketValue,
  uniqueSetsOwned,
  totalSets,
  loading,
  signedIn,
}: {
  cardCount: number;
  marketValue: number;
  uniqueSetsOwned: number;
  totalSets: number;
  loading: boolean;
  signedIn: boolean | null;
}) {
  const showValues = signedIn === true && !loading;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <StatCard
        label="Cards in Collection"
        value={showValues ? cardCount.toLocaleString() : "—"}
      />
      <StatCard
        label="Total Market Value"
        value={showValues ? formatCurrency(marketValue) : "—"}
      />
      <StatCard
        label="Sets Represented"
        value={showValues ? `${uniqueSetsOwned} / ${totalSets}` : `— / ${totalSets}`}
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
      <div className="mt-1 text-2xl font-semibold tracking-tight text-text-primary tabular-nums">
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
    <li className={`px-4 py-3 ${isFirst ? "" : "border-t border-black/8"}`}>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div className="min-w-0 flex items-baseline gap-2">
          {set.ptcgoCode && (
            <span className="text-[10px] font-bold tracking-wide rounded-md border border-black/15 px-1 py-0.5 text-text-secondary">
              {set.ptcgoCode}
            </span>
          )}
          <span className="text-sm font-semibold text-text-primary truncate">
            {set.name}
          </span>
          {released && (
            <span className="text-xs text-text-muted truncate">{released}</span>
          )}
        </div>
        <span className="text-xs font-semibold text-text-secondary tabular-nums whitespace-nowrap">
          {owned} / {set.size}
          <span className="ml-2 text-text-muted">({pct.toFixed(0)}%)</span>
        </span>
      </div>
      <div
        className="h-2 rounded-full bg-surface overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={`${set.name} completion ${pct.toFixed(0)}%`}
      >
        <div
          className="h-full bg-gradient-to-r from-accent to-[#f08c8c] transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
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
