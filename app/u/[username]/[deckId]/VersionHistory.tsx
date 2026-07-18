"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import DeckTileFooter from "@/app/components/DeckTileFooter";
import { cardImageUrlFor } from "@/lib/primaryCardImage";
import { parseDeckListCards } from "@/lib/cardPrinting";
import type { AnalysisResult } from "@/lib/analyzeDeck";

/**
 * "Alternates" — the deck's version list, rendered as rows inside a single
 * cell. Each row can expand a mini card grid of that version's contents
 * (View) and, for the owner, promote itself to the deck's main list
 * (Set Main — restore-as-new under the hood: the current main is kept in
 * history, nothing is rewritten). Deliberately routing-free: everything
 * happens inline on this page.
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
  /** Canonical deck path — used only to clear a ?v= deep link after Set Main. */
  basePath: string;
  versions: VersionSummary[];
  /** Per-version W-L-D, keyed by version id. Owner only — omit for visitors. */
  recordsByVersion?: Record<string, VersionWL>;
  /** The version currently rendered by the page (from a ?v= deep link). */
  viewingVersion: number | null;
  isOwner: boolean;
  /** When provided, renders the "New version" button in the header (the
   *  parent gates it to owners viewing the latest version). Also lets the
   *  module render its empty state instead of null. */
  onNewVersion?: () => void;
}

interface MiniTile {
  key: string;
  name: string;
  qty: number;
  section: "pokemon" | "trainer" | "energy";
  imageUrl: string | null;
}

interface VersionCards {
  tiles: MiniTile[];
  totalCards: number;
}

const COLLAPSED_COUNT = 5;
const SECTION_ORDER: Record<MiniTile["section"], number> = {
  pokemon: 0,
  trainer: 1,
  energy: 2,
};

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

/** Aggregate a version's cards by name (copies summed across printings)
 *  into image tiles, deck-list order within pokemon → trainer → energy. */
function buildTiles(
  cards: Array<{ qty: number; name: string; number: string; setCode: string; section: MiniTile["section"] }>,
): VersionCards {
  const byName = new Map<string, MiniTile>();
  let totalCards = 0;
  for (const c of cards) {
    totalCards += c.qty;
    const key = `${c.section}|${c.name.toLowerCase()}`;
    const prev = byName.get(key);
    if (prev) {
      prev.qty += c.qty;
      if (!prev.imageUrl) prev.imageUrl = cardImageUrlFor(c);
    } else {
      byName.set(key, {
        key,
        name: c.name,
        qty: c.qty,
        section: c.section,
        imageUrl: cardImageUrlFor(c),
      });
    }
  }
  const tiles = Array.from(byName.values()).sort(
    (a, b) => SECTION_ORDER[a.section] - SECTION_ORDER[b.section],
  );
  return { tiles, totalCards };
}

export default function VersionHistory({
  deckId,
  basePath,
  versions,
  recordsByVersion,
  viewingVersion,
  isOwner,
  onNewVersion,
}: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [openVersionId, setOpenVersionId] = useState<string | null>(null);
  const [cardsByVersion, setCardsByVersion] = useState<Record<string, VersionCards>>({});
  const [loadingVersionId, setLoadingVersionId] = useState<string | null>(null);
  const [settingMainId, setSettingMainId] = useState<string | null>(null);
  const [confirmSetMain, setConfirmSetMain] = useState<VersionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const latestNumber = versions[0]?.version_number ?? 1;
  const rows = expanded ? versions : versions.slice(0, COLLAPSED_COUNT);

  const totalGames = useMemo(() => {
    if (!recordsByVersion) return 0;
    return Object.values(recordsByVersion).reduce((s, r) => s + r.w + r.l + r.d, 0);
  }, [recordsByVersion]);

  // Decks predating versioning have no rows yet — show the empty state
  // (with the commit button) to the owner instead of hiding the module.
  if (versions.length === 0 && !onNewVersion) return null;

  async function toggleView(v: VersionSummary) {
    setError(null);
    if (openVersionId === v.id) {
      setOpenVersionId(null);
      return;
    }
    if (!cardsByVersion[v.id]) {
      setLoadingVersionId(v.id);
      try {
        const res = await fetch(`/api/saved-decks/${deckId}/versions/${v.id}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? "Failed to load version.");
        const analysis = data.version.analysis as AnalysisResult | null;
        const cards =
          analysis?.cards ?? parseDeckListCards(data.version.deck_list as string);
        setCardsByVersion((prev) => ({ ...prev, [v.id]: buildTiles(cards) }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load version.");
        setLoadingVersionId(null);
        return;
      }
      setLoadingVersionId(null);
    }
    setOpenVersionId(v.id);
  }

  async function performSetMain(v: VersionSummary) {
    setConfirmSetMain(null);
    setSettingMainId(v.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/saved-decks/${deckId}/versions/${v.id}/restore`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to set main deck.");
      }
      // Same page — just clear any ?v= deep link and re-render with the
      // promoted list as main.
      router.push(basePath);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to set main deck.");
    } finally {
      setSettingMainId(null);
    }
  }

  return (
    <section aria-label="Alternates">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-text-primary">Alternates</h2>
          {versions.length > 0 && (
            <span className="inline-flex items-center rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-semibold text-text-secondary">
              {versions.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {versions.length > COLLAPSED_COUNT && (
            <button
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? "Collapse alternates" : "Expand alternates"}
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
          {onNewVersion && (
            <button
              type="button"
              onClick={onNewVersion}
              className="inline-flex items-center gap-1 rounded-full bg-black border border-transparent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-80 transition-opacity touch-manipulation"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              New version
            </button>
          )}
        </div>
      </div>

      {error && <p className="mb-3 text-xs text-accent">{error}</p>}

      {/* ── Empty state (owner, pre-versioning deck) ───────── */}
      {versions.length === 0 && (
        <p className="text-sm text-text-muted text-center rounded-xl border border-black/8 bg-white px-4 py-6">
          No versions yet — commit the current list to start this deck&apos;s
          history.
        </p>
      )}

      {/* ── One cell, one row per version ──────────────────── */}
      {versions.length > 0 && (
        <div className="rounded-xl border border-black/8 bg-white divide-y divide-black/5 overflow-hidden">
          {rows.map((v) => {
            const isMain = v.version_number === latestNumber;
            const isViewing =
              viewingVersion !== null && v.version_number === viewingVersion;
            const isOpen = openVersionId === v.id;
            const record = recordsByVersion?.[v.id];
            const games = record ? record.w + record.l + record.d : 0;
            const versionCards = cardsByVersion[v.id];

            return (
              <div key={v.id} className={isViewing ? "bg-accent/[0.03]" : undefined}>
                <div className="flex items-center gap-2.5 min-w-0 px-3.5 py-3">
                  {/* Version badge */}
                  <span
                    className={`shrink-0 inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-mono font-semibold ${
                      isMain ? "bg-black text-white" : "bg-black/5 text-text-secondary"
                    }`}
                  >
                    v{v.version_number}
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="text-sm font-semibold text-text-primary truncate">
                        {versionLabel(v)}
                      </p>
                      {isMain && (
                        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-[#3d7a34] bg-[#5baa4f]/10 rounded-full px-1.5 py-0.5">
                          Main
                        </span>
                      )}
                      {record && games > 0 && (
                        <span className="shrink-0 text-[11px] font-mono font-semibold text-text-muted">
                          {record.w}–{record.l}
                          {record.d > 0 ? `–${record.d}` : ""}
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

                  {/* Actions */}
                  <div className="shrink-0 flex items-center gap-2">
                    {isOwner && !isMain && (
                      <button
                        type="button"
                        onClick={() => setConfirmSetMain(v)}
                        disabled={settingMainId !== null}
                        className="inline-flex items-center justify-center rounded-full bg-black border border-transparent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-80 transition-opacity disabled:opacity-50 touch-manipulation"
                      >
                        {settingMainId === v.id ? "Setting…" : "Set Main"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleView(v)}
                      disabled={loadingVersionId !== null && loadingVersionId !== v.id}
                      aria-expanded={isOpen}
                      className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-black/5 transition disabled:opacity-50 touch-manipulation"
                    >
                      {loadingVersionId === v.id ? "Loading…" : "View"}
                      <svg
                        className={`w-3.5 h-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Inline mini card grid */}
                {isOpen && versionCards && (
                  <div className="px-3.5 pb-3.5">
                    <div className="rounded-lg bg-[var(--surface)]/60 p-2.5">
                      <div className="flex flex-wrap gap-1">
                        {versionCards.tiles.map((t) =>
                          t.imageUrl ? (
                            <div
                              key={t.key}
                              className="relative shrink-0 w-[calc((100%-1.75rem)/8)] md:w-[calc((100%-2.75rem)/12)] rounded overflow-hidden bg-surface"
                              style={{ aspectRatio: "245 / 342" }}
                              title={`${t.name} ×${t.qty}`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={t.imageUrl}
                                alt={`${t.name} ×${t.qty}`}
                                loading="lazy"
                                className="w-full h-full object-contain"
                              />
                              <DeckTileFooter copyCount={t.qty} />
                            </div>
                          ) : (
                            <div
                              key={t.key}
                              className="relative shrink-0 w-[calc((100%-1.75rem)/8)] md:w-[calc((100%-2.75rem)/12)] rounded overflow-hidden bg-surface flex items-center justify-center"
                              style={{ aspectRatio: "245 / 342" }}
                              title={`${t.name} ×${t.qty}`}
                            >
                              <span className="px-1 text-center text-[8px] leading-tight text-text-muted">
                                {t.name}
                              </span>
                              <DeckTileFooter copyCount={t.qty} />
                            </div>
                          ),
                        )}
                      </div>
                      <p className="mt-2 text-[11px] text-text-muted text-center">
                        {versionCards.totalCards} cards
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {totalGames === 0 && recordsByVersion && versions.length > 1 && (
        <p className="mt-2 text-[11px] text-text-muted">
          Log matches to see per-version records here.
        </p>
      )}

      {/* ── Set Main confirm ───────────────────────────────── */}
      {confirmSetMain && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="set-main-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={() => setConfirmSetMain(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white/95 backdrop-blur-xl border border-black/5 p-6 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.4)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="set-main-title"
              className="text-base font-semibold text-text-primary"
            >
              Set {versionLabel(confirmSetMain)} as main?
            </h2>
            <p className="mt-2 text-sm text-text-secondary">
              This deck&apos;s profile will switch to this list. The current
              main stays in Alternates — nothing is deleted.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmSetMain(null)}
                className="inline-flex items-center justify-center rounded-full border border-black/10 bg-white px-4 py-1.5 text-xs font-semibold text-text-secondary hover:bg-black/5 transition touch-manipulation"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => performSetMain(confirmSetMain)}
                className="inline-flex items-center justify-center rounded-full bg-black px-4 py-1.5 text-xs font-semibold text-white hover:opacity-80 transition-opacity touch-manipulation"
              >
                Set Main
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
