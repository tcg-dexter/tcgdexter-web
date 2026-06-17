"use client";

import { useState, useRef, useEffect } from "react";
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

// Must match useFadeIn.ts constants — used to defer export capture until
// all card piles have finished their stagger animation.
const FADE_STAGGER_MS = 15;
const FADE_DURATION_MS = 300;

// CDN origins used by cardImages.ts — proxied through the server during
// export capture so html-to-image can embed them without canvas taint.
const CARD_CDN_PREFIXES = [
  "https://images.pokemontcg.io/",
  "https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/",
  "https://images.scrydex.com/pokemon/",
];

// 1×1 transparent PNG — fallback for any image html-to-image still can't load.
const TRANSPARENT_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

type MatStyle = "none" | "brand" | (typeof BANNER_ACCENT_KEYS)[number];

const MAT_STYLES: { key: MatStyle; gradient: string | null }[] = [
  { key: "none", gradient: null },
  { key: "brand", gradient: BRAND_BANNER_GRADIENT },
  ...BANNER_ACCENT_KEYS.map((k) => ({ key: k as MatStyle, gradient: bannerGradientFor(k) })),
];

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

function dataUrlToBlob(dataUrl: string): Blob {
  const [, base64] = dataUrl.split(",");
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: "image/png" });
}

export default function DeckMatClient({ decks }: { decks: DeckSummary[] }) {
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [tiles, setTiles] = useState<ResolvedDeckTile[] | null>(null);
  const [renderKey, setRenderKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matStyle, setMatStyle] = useState<MatStyle>("brand");
  const [exportReady, setExportReady] = useState(false);
  const matColumnRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const exportDataRef = useRef<string | null>(null);
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

  // Pre-compute the export PNG after tiles finish animating in.
  // Storing it in a ref means handleExport is synchronous from the
  // button-tap perspective, which keeps the iOS user gesture alive for
  // navigator.share (an async toPng call would expire the gesture).
  //
  // html-to-image fetches each <img> src via the global fetch. Card images
  // come from external CDNs that don't send CORS headers, so the canvas
  // would be tainted and toDataURL() would throw. We temporarily monkey-patch
  // window.fetch to route those CDN URLs through our same-origin proxy.
  useEffect(() => {
    if (!tiles?.length) {
      exportDataRef.current = null;
      setExportReady(false);
      return;
    }
    setExportReady(false);
    const animDuration = (tiles.length - 1) * FADE_STAGGER_MS + FADE_DURATION_MS;
    const timer = setTimeout(async () => {
      if (!exportRef.current) return;
      const originalFetch = window.fetch;
      try {
        window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
              ? input.href
              : (input as Request).url;
          if (CARD_CDN_PREFIXES.some((p) => url.startsWith(p))) {
            return originalFetch(
              `/api/admin/deck-mat/proxy-image?url=${encodeURIComponent(url)}`,
              init,
            );
          }
          return originalFetch(input, init);
        };
        const { toPng } = await import("html-to-image");
        exportDataRef.current = await toPng(exportRef.current, {
          pixelRatio: 3,
          backgroundColor: "#f2f2f2",
          imagePlaceholder: TRANSPARENT_PNG,
        });
        setExportReady(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Export preparation failed.");
      } finally {
        window.fetch = originalFetch;
      }
    }, animDuration + 200);
    return () => clearTimeout(timer);
  }, [tiles, matStyle]);

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

  // Synchronous from the tap's perspective — the expensive toPng was done
  // in the background. This keeps navigator.share within the iOS gesture window.
  function handleExport() {
    const dataUrl = exportDataRef.current;
    if (!dataUrl || !tiles?.length) return;

    const deckName = decks.find((d) => d.id === selectedDeckId)?.name ?? "deck-mat";
    const fileName = `${deckName.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.png`;
    const blob = dataUrlToBlob(dataUrl);
    const file = new File([blob], fileName, { type: "image/png" });

    if (navigator.canShare?.({ files: [file] })) {
      navigator.share({ files: [file] }).catch((e: unknown) => {
        if ((e as Error).name !== "AbortError") {
          setError("Share failed. Try again.");
        }
      });
    } else {
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
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
          {/* Capture area: header + mat rectangle only */}
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
            disabled={!exportReady}
            className="w-full py-2.5 rounded-full text-sm font-semibold text-white disabled:opacity-40 transition-opacity"
            style={{ background: BRAND_BANNER_GRADIENT }}
          >
            {tiles?.length && !exportReady ? "Preparing…" : "Export PNG"}
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
