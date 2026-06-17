"use client";

import { useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { toPng } from "html-to-image";
import CardImage from "@/app/cards/CardImage";
import type { ResolvedDeckTile } from "@/lib/deckTiles";
import {
  BANNER_ACCENT_KEYS,
  BRAND_BANNER_GRADIENT,
  bannerGradientFor,
} from "@/app/u/[username]/UserProfileHeader";
import { useFadeIn } from "@/lib/useFadeIn";

export interface DeckSummary {
  id: string;
  name: string;
  deckList: string;
  avatarUrl: string | null;
  wins: number;
  losses: number;
  draws: number;
}

// Each fanned copy is offset by FAN_OVERLAP × the card's width.
const FAN_OVERLAP = 0.20;
const ROW_GAP_X = 6;  // px between piles horizontally
const MAX_PILES_PER_ROW = 7;
const MAT_PADDING = 8;          // px, inner padding of the mat rectangle
const MAT_ASPECT = 13.5 / 24;   // standard playmat height/width ratio
const EXPORT_PADDING = 20;      // px, outer padding added around the exported image

type MatStyle = "none" | "brand" | (typeof BANNER_ACCENT_KEYS)[number];

const MAT_STYLES: { key: MatStyle; gradient: string | null }[] = [
  { key: "none", gradient: null },
  { key: "brand", gradient: BRAND_BANNER_GRADIENT },
  ...BANNER_ACCENT_KEYS.map((k) => ({ key: k as MatStyle, gradient: bannerGradientFor(k) })),
];

function proxied(url: string): string {
  if (!url || url.startsWith("/") || url.startsWith("data:")) return url;
  return `/api/admin/social-studio/proxy-image?url=${encodeURIComponent(url)}`;
}

function computeRows(tiles: ResolvedDeckTile[]): ResolvedDeckTile[][] {
  const rows: ResolvedDeckTile[][] = [];
  for (let i = 0; i < tiles.length; i += MAX_PILES_PER_ROW) {
    rows.push(tiles.slice(i, i + MAX_PILES_PER_ROW));
  }
  return rows;
}

function computeCardWidth(rows: ResolvedDeckTile[][], containerWidth: number): number {
  if (!rows.length || containerWidth === 0) return 60;
  const innerW = containerWidth - MAT_PADDING * 2;
  const innerH = containerWidth * MAT_ASPECT - MAT_PADDING * 2;

  // Vertical constraint: all rows must fit within mat height.
  const numRows = rows.length;
  const maxCardH = innerH / numRows;
  const maxWidthFromHeight = maxCardH * (245 / 342);

  // Horizontal constraint: piles must fit within mat width.
  let minCardWidth = maxWidthFromHeight;
  for (const row of rows) {
    const widthUnits = row.reduce(
      (sum, t) => sum + 1 + (Math.max(t.copyCount, 1) - 1) * FAN_OVERLAP,
      0,
    );
    const gaps = (row.length - 1) * ROW_GAP_X;
    minCardWidth = Math.min(minCardWidth, (innerW - gaps) / widthUnits);
  }
  return Math.floor(minCardWidth);
}

// ── Offscreen export render ──────────────────────────────────────────────────
// Mirrors the live mat layout but uses proxied image URLs so html-to-image can
// embed them without CORS issues. Rendered with createRoot/flushSync at the
// same pixel dimensions as the live mat so the export is 1:1.

interface MatExportViewProps {
  rows: ResolvedDeckTile[][];
  cardWidth: number;
  activeGradient: string | null;
  deckName: string;
  matWidth: number;
}

function MatExportView({
  rows,
  cardWidth,
  activeGradient,
  deckName,
  matWidth,
}: MatExportViewProps) {
  const matHeight = Math.round(matWidth * MAT_ASPECT);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: EXPORT_PADDING, background: "#f2f2f2" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <span style={{ fontSize: 20, fontWeight: 600, color: "#1a1a1a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
          {deckName}
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-wordmark.png" alt="TCG Dexter" width={1920} height={453} style={{ height: 30, width: "auto", flexShrink: 0 }} />
      </div>
      {/* Mat */}
      <div style={{
        borderRadius: 12,
        overflow: "hidden",
        padding: MAT_PADDING,
        background: activeGradient ?? "transparent",
        height: matHeight,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}>
        {rows.map((row, rowIdx) => {
          const isLast = rowIdx === rows.length - 1;
          return (
            <div
              key={rowIdx}
              style={{
                display: "flex",
                gap: ROW_GAP_X,
                justifyContent: isLast ? "flex-start" : "space-between",
              }}
            >
              {row.map((t) => {
                const count = Math.max(t.copyCount, 1);
                const cardHeight = Math.round((cardWidth * 342) / 245);
                const pileWidth = cardWidth + (count - 1) * cardWidth * FAN_OVERLAP;
                return (
                  <div key={t.key} style={{ position: "relative", flexShrink: 0, width: pileWidth, height: cardHeight }}>
                    {Array.from({ length: count }).map((_, i) => (
                      <div
                        key={i}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: i * cardWidth * FAN_OVERLAP,
                          width: cardWidth,
                          height: cardHeight,
                          zIndex: i,
                          borderRadius: 4,
                          overflow: "hidden",
                          background: "#e8e8e8",
                          boxShadow: i > 0 ? "-4px 0 4px rgba(0,0,0,0.25)" : undefined,
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={proxied(t.smallImageUrl)}
                          alt={t.name}
                          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                        />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

async function rasterizeMat(props: MatExportViewProps): Promise<string> {
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${props.matWidth + EXPORT_PADDING * 2}px;overflow:hidden;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => {
      root.render(<MatExportView {...props} />);
    });
    await Promise.all(
      Array.from(host.querySelectorAll("img")).map((img) =>
        img.decode().catch(() => undefined),
      ),
    );
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return await toPng(host.firstElementChild as HTMLElement, {
      pixelRatio: 3,
      backgroundColor: "#f2f2f2",
    });
  } finally {
    root.unmount();
    host.remove();
  }
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ────────────────────────────────────────────────────────────────────────────

export default function DeckMatClient({ decks }: { decks: DeckSummary[] }) {
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [tiles, setTiles] = useState<ResolvedDeckTile[] | null>(null);
  const [renderKey, setRenderKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matStyle, setMatStyle] = useState<MatStyle>("brand");
  const [isExporting, setIsExporting] = useState(false);
  const matColumnRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const [matWidth, setMatWidth] = useState(0);

  useEffect(() => {
    const el = matColumnRef.current;
    if (!el) return;
    // Observe the column, not the mat — avoids a feedback loop where
    // rendering cards inside the mat changes the mat's measured size.
    const ro = new ResizeObserver(([entry]) => setMatWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  async function handleSelectDeck(deck: DeckSummary) {
    setSelectedDeckId(deck.id);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/deck-mat/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deckList: deck.deckList }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      const body = await res.json();
      setTiles(body.tiles ?? []);
      setRenderKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to render deck.");
    } finally {
      setLoading(false);
    }
  }

  async function handleExport() {
    if (!tiles?.length || !matWidth) return;
    setIsExporting(true);
    setError(null);
    try {
      const deckName = decks.find((d) => d.id === selectedDeckId)?.name ?? "";
      const fileName = `${deckName.replace(/[^a-z0-9]/gi, "-").toLowerCase() || "deck-mat"}.png`;
      const activeGradient = MAT_STYLES.find((s) => s.key === matStyle)?.gradient ?? null;
      const dataUrl = await rasterizeMat({ rows, cardWidth, activeGradient, deckName, matWidth });
      downloadDataUrl(dataUrl, fileName);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setIsExporting(false);
    }
  }

  const rows = tiles ? computeRows(tiles) : [];
  const cardWidth = computeCardWidth(rows, matWidth);
  const activeGradient = MAT_STYLES.find((s) => s.key === matStyle)?.gradient ?? null;
  const emptyTextStyle = activeGradient ? { color: "rgba(255,255,255,0.5)" as const } : undefined;
  const emptyTextClass = activeGradient ? "" : "text-text-muted";

  return (
    <>
      <div className="flex flex-col gap-6">
        {/* Mat */}
        <div ref={matColumnRef} className="flex flex-col gap-3">
          <div ref={exportRef} className="flex flex-col gap-3">
            {/* Mat header: deck name left, site logo right */}
            <div className="flex items-center justify-between gap-4">
              <span className="text-xl font-semibold text-text-primary truncate">
                {decks.find((d) => d.id === selectedDeckId)?.name ?? ""}
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo-wordmark.png"
                alt="TCG Dexter"
                width={1920}
                height={453}
                className="h-[30px] w-auto flex-shrink-0"
              />
            </div>

            <div
              className="rounded-xl overflow-hidden"
              style={{
                padding: MAT_PADDING,
                background: activeGradient ?? "transparent",
                height: matWidth > 0 ? matWidth * MAT_ASPECT : undefined,
              }}
            >
              {!tiles ? (
                <div className="h-full flex items-center justify-center text-sm" style={emptyTextStyle}>
                  <span className={emptyTextClass}>Select a deck to lay out the mat.</span>
                </div>
              ) : tiles.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm" style={emptyTextStyle}>
                  <span className={emptyTextClass}>No cards parsed from this list.</span>
                </div>
              ) : (
                <div
                  key={renderKey}
                  className="flex flex-col h-full"
                  style={{ justifyContent: "space-between" }}
                >
                  {rows.map((row, rowIdx) => (
                    <div
                      key={rowIdx}
                      className="flex"
                      style={{ gap: ROW_GAP_X, justifyContent: rowIdx < rows.length - 1 ? "space-between" : "flex-start" }}
                    >
                      {row.map((t, colIdx) => (
                        <CardPile key={t.key} tile={t} cardWidth={cardWidth} index={rowIdx * MAX_PILES_PER_ROW + colIdx} />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Style picker */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {MAT_STYLES.map(({ key, gradient }) => (
              <button
                key={key}
                type="button"
                onClick={() => setMatStyle(key)}
                aria-label={key}
                className={`w-7 h-7 rounded-full transition-all ${
                  matStyle === key
                    ? "ring-2 ring-black ring-offset-1 ring-offset-[#f2f2f2] scale-110"
                    : "hover:ring-1 hover:ring-black/25 hover:ring-offset-1 hover:ring-offset-[#f2f2f2]"
                }`}
                style={gradient ? { background: gradient } : { background: "#e8e8e8" }}
              >
                {!gradient && (
                  <span className="block w-full h-full flex items-center justify-center text-[10px] font-bold text-text-muted leading-none">
                    ✕
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Export button */}
          <button
            type="button"
            onClick={handleExport}
            disabled={!tiles?.length || isExporting}
            className="w-full py-2.5 rounded-full text-sm font-semibold text-white disabled:opacity-40 transition-opacity"
            style={{ background: BRAND_BANNER_GRADIENT }}
          >
            {isExporting ? "Exporting…" : "Export PNG"}
          </button>
        </div>

        {/* Deck list */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Your decks
          </label>

          {decks.length === 0 ? (
            <p className="text-sm text-text-muted py-4">No saved decks yet.</p>
          ) : (
            <ul className="flex flex-col gap-1 rounded-2xl bg-white border border-black/8 p-2">
              {decks.map((deck) => {
                const total = deck.wins + deck.losses + deck.draws;
                const isSelected = deck.id === selectedDeckId;
                const isLoading = isSelected && loading;
                return (
                  <li key={deck.id}>
                    <button
                      type="button"
                      onClick={() => !isLoading && handleSelectDeck(deck)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition ${
                        isSelected ? "bg-black/5" : "hover:bg-black/4"
                      }`}
                    >
                      <div className="w-10 h-[54px] flex-shrink-0 rounded overflow-hidden bg-surface">
                        {deck.avatarUrl ? (
                          <img src={deck.avatarUrl} alt="" className="w-full h-full object-contain" loading="lazy" />
                        ) : (
                          <div className="w-full h-full bg-surface" />
                        )}
                      </div>
                      <span className="flex-1 min-w-0 text-sm font-semibold text-text-primary truncate">
                        {deck.name}
                      </span>
                      {total > 0 && (
                        <span className="flex-shrink-0 inline-flex items-baseline tabular-nums font-bold text-[10px] leading-none bg-black rounded-full px-2 py-[3px] text-white">
                          <span>{deck.wins}</span>
                          <span className="mx-[3px]">-</span>
                          <span>{deck.losses}</span>
                          {deck.draws > 0 && (
                            <>
                              <span className="mx-[3px]">-</span>
                              <span>{deck.draws}</span>
                            </>
                          )}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {error && <p className="text-xs text-accent">{error}</p>}
        </div>
      </div>
    </>
  );
}

function CardPile({
  tile,
  cardWidth,
  index,
}: {
  tile: ResolvedDeckTile;
  cardWidth: number;
  index: number;
}) {
  const fadeStyle = useFadeIn(index);
  const cardHeight = Math.round((cardWidth * 342) / 245);
  const count = Math.max(tile.copyCount, 1);
  const pileWidth = cardWidth + (count - 1) * cardWidth * FAN_OVERLAP;
  const alt = tile.setName
    ? `${tile.name} — ${tile.setName} ${tile.number}`
    : `${tile.name} ${tile.number}`;

  return (
    <div
      className="relative shrink-0"
      style={{ width: pileWidth, height: cardHeight, ...fadeStyle }}
      aria-label={`${tile.name} ×${count}`}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="absolute top-0 rounded overflow-hidden bg-surface"
          style={{
            left: i * cardWidth * FAN_OVERLAP,
            width: cardWidth,
            height: cardHeight,
            zIndex: i,
            boxShadow: i > 0 ? "-4px 0 4px rgba(0,0,0,0.25)" : undefined,
          }}
        >
          <CardImage
            src={tile.smallImageUrl}
            alt={alt}
            name={tile.name}
            setName={tile.setName}
            number={tile.number}
            className="w-full h-full object-contain"
          />
        </div>
      ))}
    </div>
  );
}
