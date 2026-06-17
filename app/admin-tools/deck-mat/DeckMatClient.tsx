"use client";

import { useState, useRef, useEffect } from "react";
import CardImage from "@/app/cards/CardImage";
import type { ResolvedDeckTile } from "@/lib/deckTiles";
import {
  BANNER_ACCENT_KEYS,
  BRAND_BANNER_GRADIENT,
  bannerGradientFor,
} from "@/app/u/[username]/UserProfileHeader";

const EXAMPLE_DECK = `Pokémon: 13
1 Meowth ex POR 62
3 N's Zoroark ex JTG 175
1 Munkidori TWM 95
1 Pecharunt ex SFA 39
1 N's Zorua PR-SV 189
1 Fezandipiti ex ASC 142
3 N's Zorua ASC 136
2 N's Reshiram ASC 154

Trainer: 15
4 N's PP Up ASC 195
3 Lillie's Determination ASC 192
1 Night Stretcher MEG 173
2 Janine's Secret Art SFA 59
2 Boss's Orders MEG 114
4 Ultra Ball MEG 131
2 N's Castle JTG 152

Energy: 1
8 Basic {D} Energy MEE 7

Total Cards: 60`;

// Each fanned copy is offset by FAN_OVERLAP × the card's width.
const FAN_OVERLAP = 0.20;
const ROW_GAP_X = 6;  // px between piles horizontally
const ROW_GAP_Y = 5;  // px between rows vertically
const MAX_PILES_PER_ROW = 5;
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
  const maxCardH = (innerH - (numRows - 1) * ROW_GAP_Y) / numRows;
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

export default function DeckMatClient() {
  const [deckList, setDeckList] = useState(EXAMPLE_DECK);
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

  async function handleRender() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/deck-mat/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deckList }),
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

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6 items-start">
        {/* Input column */}
        <div className="flex flex-col gap-3">
          <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Deck list
          </label>
          <textarea
            value={deckList}
            onChange={(e) => setDeckList(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="w-full h-[420px] rounded-2xl border border-black/10 bg-white p-3 font-mono text-xs leading-relaxed text-text-primary focus:outline-none focus-gradient-border transition-colors"
            placeholder="Paste a PTCGO/PTCGL deck list…"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleRender}
              disabled={loading || !deckList.trim()}
              className="text-sm font-semibold px-4 py-2 rounded-full border border-transparent bg-gradient-brand bg-origin-border text-white shadow-brand hover:shadow-brand-lg disabled:opacity-40 disabled:shadow-none transition"
            >
              {loading ? "Rendering…" : "Render mat"}
            </button>
            {error && (
              <span className="text-xs text-accent">{error}</span>
            )}
          </div>
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
              <div className="h-full flex items-center justify-center text-sm" style={{ color: activeGradient ? "rgba(255,255,255,0.5)" : undefined }}>
                <span className={activeGradient ? "" : "text-text-muted"}>Render a deck list to lay out the mat.</span>
              </div>
            ) : tiles.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm" style={{ color: activeGradient ? "rgba(255,255,255,0.5)" : undefined }}>
                <span className={activeGradient ? "" : "text-text-muted"}>No cards parsed from this list.</span>
              </div>
            ) : (
              <div className="flex flex-col" style={{ gap: ROW_GAP_Y }}>
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
                style={
                  gradient
                    ? { background: gradient }
                    : { background: "#e8e8e8" }
                }
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
          className="absolute top-0 rounded overflow-hidden bg-surface shadow-sm"
          style={{
            left: i * cardWidth * FAN_OVERLAP,
            width: cardWidth,
            height: cardHeight,
            zIndex: i,
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
