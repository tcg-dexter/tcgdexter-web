"use client";

import { useState, useRef, useEffect } from "react";
import CardImage from "@/app/cards/CardImage";
import type { ResolvedDeckTile } from "@/lib/deckTiles";
import {
  BANNER_ACCENT_KEYS,
  BRAND_BANNER_GRADIENT,
  bannerGradientFor,
} from "@/app/u/[username]/UserProfileHeader";

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

export default function DeckMatClient({ decks }: { decks: DeckSummary[] }) {
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [tiles, setTiles] = useState<ResolvedDeckTile[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matStyle, setMatStyle] = useState<MatStyle>("brand");
  const matColumnRef = useRef<HTMLDivElement>(null);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to render deck.");
    } finally {
      setLoading(false);
    }
  }

  const rows = tiles ? computeRows(tiles) : [];
  const cardWidth = computeCardWidth(rows, matWidth);
  const activeGradient = MAT_STYLES.find((s) => s.key === matStyle)?.gradient ?? null;
  const emptyTextStyle = activeGradient ? { color: "rgba(255,255,255,0.5)" as const } : undefined;
  const emptyTextClass = activeGradient ? "" : "text-text-muted";

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 items-start">
        {/* Deck list column */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Your decks
          </label>

          {decks.length === 0 ? (
            <p className="text-sm text-text-muted py-4">No saved decks yet.</p>
          ) : (
            <ul className="flex flex-col gap-1 max-h-[420px] overflow-y-auto rounded-2xl bg-white border border-black/8 p-2">
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
                        isSelected
                          ? "bg-black/5"
                          : "hover:bg-black/4"
                      }`}
                    >
                      {/* Avatar */}
                      <div className="w-10 h-[54px] flex-shrink-0 rounded overflow-hidden bg-surface">
                        {deck.avatarUrl ? (
                          <img
                            src={deck.avatarUrl}
                            alt=""
                            className="w-full h-full object-contain"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full bg-surface" />
                        )}
                      </div>

                      {/* Name */}
                      <span className="flex-1 min-w-0 text-sm font-semibold text-text-primary truncate">
                        {deck.name}
                      </span>

                      {/* W-L-T pill */}
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

        {/* Mat column — first on mobile, second on desktop */}
        <div ref={matColumnRef} className="flex flex-col gap-3 order-first lg:order-2">
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
                className="flex flex-col h-full"
                style={{ justifyContent: "space-between" }}
              >
                {rows.map((row, i) => (
                  <div
                    key={i}
                    className="flex"
                    style={{ gap: ROW_GAP_X, justifyContent: i < rows.length - 1 ? "space-between" : "flex-start" }}
                  >
                    {row.map((t) => (
                      <CardPile key={t.key} tile={t} cardWidth={cardWidth} />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Style picker anchored below the mat */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {MAT_STYLES.map(({ key, gradient }) => (
              <button
                key={key}
                type="button"
                onClick={() => setMatStyle(key)}
                aria-label={key}
                className={`w-7 h-7 rounded-full border-2 transition ${
                  matStyle === key
                    ? "border-black scale-110"
                    : "border-transparent hover:border-black/30"
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
        </div>
      </div>
    </>
  );
}

function CardPile({
  tile,
  cardWidth,
}: {
  tile: ResolvedDeckTile;
  cardWidth: number;
}) {
  const cardHeight = Math.round((cardWidth * 342) / 245);
  const count = Math.max(tile.copyCount, 1);
  const pileWidth = cardWidth + (count - 1) * cardWidth * FAN_OVERLAP;
  const alt = tile.setName
    ? `${tile.name} — ${tile.setName} ${tile.number}`
    : `${tile.name} ${tile.number}`;

  return (
    <div
      className="relative shrink-0"
      style={{ width: pileWidth, height: cardHeight }}
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
            boxShadow: i > 0 ? "-4px 0 6px rgba(0,0,0,0.25)" : undefined,
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
