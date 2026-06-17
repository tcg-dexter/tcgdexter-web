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
const EXPORT_PADDING = 15;      // px, outer padding added around the exported image

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

// ── Canvas export ────────────────────────────────────────────────────────────
// Draws the mat directly onto a <canvas> — no html-to-image, no library
// caching, no CORS intermediary. Pre-fetches every image as a data URL through
// the same-origin proxy, decodes them into HTMLImageElement objects, then
// draws the full layout imperatively with the Canvas 2D API.

async function fetchAsDataUrl(url: string): Promise<string> {
  const fetchUrl = proxied(url);
  try {
    const res = await fetch(fetchUrl);
    if (!res.ok) {
      console.warn(`[DeckMat] fetch failed ${res.status} for ${fetchUrl}`);
      return "";
    }
    const blob = await res.blob();
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string) ?? "");
      reader.onerror = () => {
        console.warn(`[DeckMat] FileReader error for ${url}`);
        resolve("");
      };
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.warn(`[DeckMat] fetch threw for ${fetchUrl}:`, err);
    return "";
  }
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("img load failed"));
    img.src = src;
  });
}

// Parses a CSS linear-gradient(180deg, #hex stop%, ...) string into a
// CanvasGradient. Only handles the top-to-bottom variants used by the mat
// style picker — not a general CSS gradient parser.
function cssGradToCanvas(
  ctx: CanvasRenderingContext2D,
  css: string,
  x: number,
  y: number,
  h: number,
): CanvasGradient | null {
  const m = css.match(/linear-gradient\(\s*180deg\s*,\s*(.+)\s*\)/);
  if (!m) return null;
  const stopRe = /(#[0-9a-fA-F]{6})\s+(\d+(?:\.\d+)?)%/g;
  const stops: Array<{ color: string; pct: number }> = [];
  let hit: RegExpExecArray | null;
  while ((hit = stopRe.exec(m[1])) !== null) {
    stops.push({ color: hit[1], pct: parseFloat(hit[2]) / 100 });
  }
  if (stops.length < 2) return null;
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  for (const s of stops) grad.addColorStop(s.pct, s.color);
  return grad;
}

// Draws an image scaled to contain within (w × h), centered.
function drawContain(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (!iw || !ih) return;
  const scale = Math.min(w / iw, h / ih);
  const sw = iw * scale;
  const sh = ih * scale;
  ctx.drawImage(img, x + (w - sw) / 2, y + (h - sh) / 2, sw, sh);
}

async function rasterizeMat({
  rows,
  cardWidth,
  activeGradient,
  deckName,
  matWidth,
}: {
  rows: ResolvedDeckTile[][];
  cardWidth: number;
  activeGradient: string | null;
  deckName: string;
  matWidth: number;
}): Promise<string> {
  // ── 1. Pre-fetch all images as data URLs ──────────────────────────────────
  const uniqueCardUrls = Array.from(
    new Set(rows.flat().map((t) => t.smallImageUrl).filter(Boolean)),
  );
  const urls = ["/logo-wordmark.png", ...uniqueCardUrls];
  const dataUrlMap = new Map<string, string>();
  await Promise.all(
    urls.map(async (url) => {
      const dataUrl = await fetchAsDataUrl(url);
      if (dataUrl) dataUrlMap.set(url, dataUrl);
    }),
  );
  const failed = urls.filter((u) => !dataUrlMap.has(u));
  if (failed.length) {
    console.warn(`[DeckMat] ${failed.length}/${urls.length} pre-fetches failed:`, failed);
  }

  // ── 2. Decode into HTMLImageElement objects ───────────────────────────────
  const imageMap = new Map<string, HTMLImageElement>();
  await Promise.all(
    Array.from(dataUrlMap.entries()).map(async ([url, dataUrl]) => {
      try {
        imageMap.set(url, await loadImg(dataUrl));
      } catch {
        console.warn(`[DeckMat] decode failed:`, url);
      }
    }),
  );

  // ── 3. Canvas dimensions ──────────────────────────────────────────────────
  const PR = 3; // pixel ratio
  const matHeight = Math.round(matWidth * MAT_ASPECT);
  const HEADER_H = 30; // logo height drives the header row
  const GAP = 12;
  const totalW = matWidth + EXPORT_PADDING * 2;
  const totalH = EXPORT_PADDING + HEADER_H + GAP + matHeight + EXPORT_PADDING;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(totalW * PR);
  canvas.height = Math.round(totalH * PR);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable");
  ctx.scale(PR, PR);

  // ── 4. Page background ────────────────────────────────────────────────────
  ctx.fillStyle = "#f2f2f2";
  ctx.fillRect(0, 0, totalW, totalH);

  // ── 5. Header: deck name + logo ───────────────────────────────────────────
  const headerY = EXPORT_PADDING;
  const logoImg = imageMap.get("/logo-wordmark.png");
  const LOGO_H = 30;
  const logoW = logoImg
    ? Math.round(LOGO_H * (logoImg.naturalWidth / logoImg.naturalHeight))
    : 0;
  const nameMaxW =
    totalW - EXPORT_PADDING * 2 - (logoW > 0 ? logoW + 16 : 0);

  ctx.font =
    '600 20px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = "#1a1a1a";
  ctx.textBaseline = "middle";

  let displayName = deckName;
  if (ctx.measureText(displayName).width > nameMaxW) {
    while (displayName.length > 0 && ctx.measureText(displayName + "…").width > nameMaxW) {
      displayName = displayName.slice(0, -1);
    }
    displayName += "…";
  }
  ctx.fillText(displayName, EXPORT_PADDING, headerY + HEADER_H / 2);

  if (logoImg) {
    ctx.drawImage(logoImg, totalW - EXPORT_PADDING - logoW, headerY, logoW, LOGO_H);
  }

  // ── 6. Mat background ─────────────────────────────────────────────────────
  const matX = EXPORT_PADDING;
  const matY = EXPORT_PADDING + HEADER_H + GAP;

  if (activeGradient) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(matX, matY, matWidth, matHeight, 12);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle =
      cssGradToCanvas(ctx, activeGradient, matX, matY, matHeight) ?? "#888";
    ctx.fillRect(matX, matY, matWidth, matHeight);
    ctx.restore();
  }

  // ── 7. Card piles ─────────────────────────────────────────────────────────
  const innerX = matX + MAT_PADDING;
  const innerY = matY + MAT_PADDING;
  const innerW = matWidth - MAT_PADDING * 2;
  const innerH = matHeight - MAT_PADDING * 2;
  const numRows = rows.length;
  const cardH = Math.round((cardWidth * 342) / 245);

  for (let rowIdx = 0; rowIdx < numRows; rowIdx++) {
    const row = rows[rowIdx];
    const isLast = rowIdx === numRows - 1;

    // Row Y: flex column space-between
    const ry =
      numRows <= 1
        ? innerY
        : innerY + (rowIdx * (innerH - cardH)) / (numRows - 1);

    const pileWidths = row.map(
      (t) => cardWidth + (Math.max(t.copyCount, 1) - 1) * cardWidth * FAN_OVERLAP,
    );
    const totalPileW = pileWidths.reduce((a, b) => a + b, 0);

    // Pile X spacing: space-between for full rows, flex-start for last
    const spaceBetween =
      isLast || row.length <= 1
        ? ROW_GAP_X
        : Math.max(ROW_GAP_X, (innerW - totalPileW) / (row.length - 1));

    let pileX = innerX;

    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const t = row[colIdx];
      const count = Math.max(t.copyCount, 1);
      const cardImg = imageMap.get(t.smallImageUrl);

      for (let i = 0; i < count; i++) {
        const cx = pileX + i * cardWidth * FAN_OVERLAP;

        // Card slot background
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(cx, ry, cardWidth, cardH, 4);
        ctx.closePath();
        ctx.fillStyle = "#e8e8e8";
        ctx.fill();
        ctx.restore();

        // Card image clipped to slot
        if (cardImg) {
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(cx, ry, cardWidth, cardH, 4);
          ctx.closePath();
          ctx.clip();
          drawContain(ctx, cardImg, cx, ry, cardWidth, cardH);
          ctx.restore();
        }
      }

      pileX += pileWidths[colIdx] + spaceBetween;
    }
  }

  return canvas.toDataURL("image/png");
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
