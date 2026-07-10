"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import VersionDiff from "./VersionDiff";

/**
 * The deck's commit log. Newest first; each row is a version with its
 * badge, optional name, changelog, date, and (owner) per-version W-L-D.
 * View renders that version read-only via ?v={n}; Restore re-commits an
 * old version as the new head; Compare diffs any two versions.
 */

export interface VersionSummary {
  id: string;
  version_number: number;
  name: string | null;
  changelog: string;
  created_at: string;
}

interface VersionWL {
  w: number;
  l: number;
  d: number;
}

interface Props {
  deckId: string;
  /** Canonical deck path (short_id form), e.g. /u/ash/k8m2x7q9. */
  basePath: string;
  versions: VersionSummary[];
  /** Per-version W-L-D, keyed by version id. Owner only — omit for visitors. */
  recordsByVersion?: Record<string, VersionWL>;
  /** The version currently rendered by the page (from ?v=), if not latest. */
  viewingVersion: number | null;
  isOwner: boolean;
}

const COLLAPSED_COUNT = 3;

function versionLabel(v: VersionSummary): string {
  return v.name ?? `v${v.version_number}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export default function VersionHistory({
  deckId,
  basePath,
  versions,
  recordsByVersion,
  viewingVersion,
  isOwner,
}: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [compareFrom, setCompareFrom] = useState<VersionSummary | null>(null);
  const [diffPair, setDiffPair] = useState<{ from: VersionSummary; to: VersionSummary } | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<VersionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const latestNumber = versions[0]?.version_number ?? 1;
  const rows = expanded ? versions : versions.slice(0, COLLAPSED_COUNT);

  const totalGames = useMemo(() => {
    if (!recordsByVersion) return 0;
    return Object.values(recordsByVersion).reduce((s, r) => s + r.w + r.l + r.d, 0);
  }, [recordsByVersion]);

  if (versions.length === 0) return null;

  function pickCompare(v: VersionSummary) {
    setError(null);
    if (!compareFrom) {
      setCompareFrom(v);
      setDiffPair(null);
      return;
    }
    if (compareFrom.id === v.id) {
      setCompareFrom(null);
      return;
    }
    // Diff always reads older → newer regardless of click order.
    const [older, newer] =
      compareFrom.version_number < v.version_number
        ? [compareFrom, v]
        : [v, compareFrom];
    setDiffPair({ from: older, to: newer });
    setCompareFrom(null);
  }

  async function performRestore(v: VersionSummary) {
    setConfirmRestore(null);
    setRestoring(v.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/saved-decks/${deckId}/versions/${v.id}/restore`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to restore version.");
      }
      // Land on the new head — the restored content is now latest.
      router.push(basePath);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to restore version.");
    } finally {
      setRestoring(null);
    }
  }

  return (
    <section aria-label="Version history">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-text-primary">Version History</h2>
          <span className="inline-flex items-center rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-semibold text-text-secondary">
            {versions.length}
          </span>
        </div>
        {versions.length > COLLAPSED_COUNT && (
          <button
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Collapse version history" : "Expand version history"}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-text-muted hover:text-text-primary hover:bg-black/5 transition-colors"
          >
            {expanded ? "Less" : "More"}
            <svg
              className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
        )}
      </div>

      {/* ── Compare hint ───────────────────────────────────── */}
      {compareFrom && (
        <div className="mb-3 flex items-center justify-between rounded-xl border border-black/8 bg-white px-3 py-2">
          <p className="text-xs text-text-secondary">
            Comparing <span className="font-semibold text-text-primary">{versionLabel(compareFrom)}</span> — pick another version
          </p>
          <button
            type="button"
            onClick={() => setCompareFrom(null)}
            className="text-xs font-semibold text-text-muted hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {error && <p className="mb-3 text-xs text-accent">{error}</p>}

      {/* ── Rows ───────────────────────────────────────────── */}
      <ol className="flex flex-col gap-2">
        {rows.map((v) => {
          const isLatest = v.version_number === latestNumber;
          const isViewing = viewingVersion !== null && v.version_number === viewingVersion;
          const isCompareArm = compareFrom?.id === v.id;
          const record = recordsByVersion?.[v.id];
          const games = record ? record.w + record.l + record.d : 0;
          const viewHref = isLatest ? basePath : `${basePath}?v=${v.version_number}`;

          return (
            <li
              key={v.id}
              className={`rounded-xl border bg-white p-3 transition-colors ${
                isViewing
                  ? "border-accent/50 shadow-[0_0_0_1px_var(--accent)]"
                  : isCompareArm
                  ? "border-black/30"
                  : "border-black/8"
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {/* Version badge */}
                <span
                  className={`shrink-0 inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-mono font-semibold ${
                    isLatest
                      ? "bg-black text-white"
                      : "bg-black/5 text-text-secondary"
                  }`}
                >
                  v{v.version_number}
                </span>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">
                      {v.name ?? `v${v.version_number}`}
                    </p>
                    {isLatest && (
                      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-[#3d7a34] bg-[#5baa4f]/10 rounded-full px-1.5 py-0.5">
                        Current
                      </span>
                    )}
                    {isViewing && !isLatest && (
                      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-accent bg-accent/10 rounded-full px-1.5 py-0.5">
                        Viewing
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-muted truncate">
                    {formatDate(v.created_at)}
                    {v.changelog && (
                      <>
                        {" · "}
                        <span className="text-text-secondary">{v.changelog}</span>
                      </>
                    )}
                  </p>
                </div>

                {/* Per-version record (owner) */}
                {record && games > 0 && (
                  <span className="shrink-0 text-xs font-mono font-semibold text-text-secondary">
                    {record.w}–{record.l}
                    {record.d > 0 ? `–${record.d}` : ""}
                  </span>
                )}
              </div>

              {/* Action row */}
              <div className="mt-2.5 flex items-center gap-2">
                {!(isLatest && viewingVersion === null) && (
                  <Link
                    href={viewHref}
                    className="inline-flex items-center justify-center rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-black/5 transition touch-manipulation"
                  >
                    {isLatest ? "View latest" : "View"}
                  </Link>
                )}
                {isOwner && !isLatest && (
                  <button
                    type="button"
                    onClick={() => setConfirmRestore(v)}
                    disabled={restoring !== null}
                    className="inline-flex items-center justify-center rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-black/5 transition disabled:opacity-50 touch-manipulation"
                  >
                    {restoring === v.id ? "Restoring…" : "Restore"}
                  </button>
                )}
                {versions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => pickCompare(v)}
                    aria-pressed={isCompareArm}
                    className={`ml-auto inline-flex items-center justify-center rounded-full px-3 py-1.5 text-xs font-semibold transition touch-manipulation ${
                      isCompareArm
                        ? "bg-black text-white border border-transparent"
                        : "border border-black/10 bg-white text-text-secondary hover:bg-black/5"
                    }`}
                  >
                    {isCompareArm ? "Comparing…" : "Compare"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {totalGames === 0 && recordsByVersion && versions.length > 1 && (
        <p className="mt-2 text-[11px] text-text-muted">
          Log matches to see per-version records here.
        </p>
      )}

      {/* ── Diff panel ─────────────────────────────────────── */}
      {diffPair && (
        <VersionDiff
          deckId={deckId}
          from={{ id: diffPair.from.id, label: versionLabel(diffPair.from) }}
          to={{ id: diffPair.to.id, label: versionLabel(diffPair.to) }}
          onClose={() => setDiffPair(null)}
        />
      )}

      {/* ── Restore confirm ────────────────────────────────── */}
      {confirmRestore && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="restore-version-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={() => setConfirmRestore(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white/95 backdrop-blur-xl border border-black/5 p-6 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.4)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="restore-version-title"
              className="text-base font-semibold text-text-primary"
            >
              Restore {versionLabel(confirmRestore)}?
            </h2>
            <p className="mt-2 text-sm text-text-secondary">
              This copies {versionLabel(confirmRestore)} to a new version at
              the top of the history — nothing is deleted or rewritten.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmRestore(null)}
                className="inline-flex items-center justify-center rounded-full border border-black/10 bg-white px-4 py-1.5 text-xs font-semibold text-text-secondary hover:bg-black/5 transition touch-manipulation"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => performRestore(confirmRestore)}
                className="inline-flex items-center justify-center rounded-full bg-black px-4 py-1.5 text-xs font-semibold text-white hover:opacity-80 transition-opacity touch-manipulation"
              >
                Restore
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
