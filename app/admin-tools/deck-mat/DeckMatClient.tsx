"use client";

import { useState, useRef, useEffect } from "react";
import CardImage from "@/app/cards/CardImage";
import type { ResolvedDeckTile } from "@/lib/deckTiles";
import {
  BANNER_ACCENT_KEYS,
  BRAND_BANNER_GRADIENT,
  bannerGradientFor,
} from "@/app/u/[username]/UserProfileHeader";
import { ENERGY_HEX } from "@/app/components/DeckProfileView";
import { shade } from "@/lib/color";
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

// The "dark" stop used at the bottom of each energy gradient (shade -22%).
function ed(key: string): string {
  return shade(ENERGY_HEX[key] ?? "#888888", -22);
}

const DUO_STYLE_KEYS = [
  "fire-psychic",
  "water-dragon",
  "lightning-grass",
  "psychic-fairy",
  "grass-water",
  "fire-lightning",
  "fighting-darkness",
  "metal-dragon",
  "water-psychic",
] as const;

const DUO_GRADIENTS: Record<(typeof DUO_STYLE_KEYS)[number], string> = {
  "fire-psychic":      `linear-gradient(180deg, ${ed("Fire")} 0%, ${ed("Psychic")} 100%)`,
  "water-dragon":      `linear-gradient(180deg, ${ed("Water")} 0%, ${ed("Dragon")} 100%)`,
  "lightning-grass":   `linear-gradient(180deg, ${ed("Lightning")} 0%, ${ed("Grass")} 100%)`,
  "psychic-fairy":     `linear-gradient(180deg, ${ed("Psychic")} 0%, ${ed("Fairy")} 100%)`,
  "grass-water":       `linear-gradient(180deg, ${ed("Grass")} 0%, ${ed("Water")} 100%)`,
  "fire-lightning":    `linear-gradient(180deg, ${ed("Fire")} 0%, ${ed("Lightning")} 100%)`,
  "fighting-darkness": `linear-gradient(180deg, ${ed("Fighting")} 0%, ${ed("Darkness")} 100%)`,
  "metal-dragon":      `linear-gradient(180deg, ${ed("Metal")} 0%, ${ed("Dragon")} 100%)`,
  "water-psychic":     `linear-gradient(180deg, ${ed("Water")} 0%, ${ed("Psychic")} 100%)`,
};

type MatStyle = "black" | "brand" | (typeof BANNER_ACCENT_KEYS)[number] | (typeof DUO_STYLE_KEYS)[number];

const BLACK_GRADIENT = "linear-gradient(180deg, #3a3a3a 0%, #141414 100%)";

const MAT_STYLES: { key: MatStyle; gradient: string }[] = [
  { key: "brand", gradient: BRAND_BANNER_GRADIENT },
  { key: "black", gradient: BLACK_GRADIENT },
  ...BANNER_ACCENT_KEYS.map((k) => ({ key: k as MatStyle, gradient: bannerGradientFor(k) })),
  ...DUO_STYLE_KEYS.map((k) => ({ key: k as MatStyle, gradient: DUO_GRADIENTS[k] })),
];

// Each texture is a small SVG tile that repeats seamlessly. Opacity is baked
// into the SVG so the pattern works identically in CSS background-image (live
// mat) and ctx.createPattern (canvas export).
const TEXTURES: ReadonlyArray<{ key: string; w: number; h: number; svg: string }> = [
  {
    key: "lines",
    w: 8, h: 8,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><line x1="0" y1="8" x2="8" y2="0" stroke="white" stroke-width="1" stroke-opacity="0.22"/></svg>`,
  },
  {
    key: "dots",
    w: 8, h: 8,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><circle cx="4" cy="4" r="1.2" fill="white" fill-opacity="0.25"/></svg>`,
  },
  {
    key: "grid",
    w: 10, h: 10,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><path d="M0 0V10M0 0H10" stroke="white" stroke-width="0.5" stroke-opacity="0.2"/></svg>`,
  },
  {
    key: "crosshatch",
    w: 8, h: 8,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><line x1="0" y1="8" x2="8" y2="0" stroke="white" stroke-width="0.75" stroke-opacity="0.15"/><line x1="0" y1="0" x2="8" y2="8" stroke="white" stroke-width="0.75" stroke-opacity="0.15"/></svg>`,
  },
  {
    key: "diamonds",
    w: 12, h: 12,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><polygon points="6,1 11,6 6,11 1,6" fill="none" stroke="white" stroke-width="0.75" stroke-opacity="0.22"/></svg>`,
  },
  {
    key: "chevron",
    w: 20, h: 10,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><polyline points="0,10 10,0 20,10" fill="none" stroke="white" stroke-width="0.75" stroke-opacity="0.22"/></svg>`,
  },
  {
    key: "waves",
    w: 20, h: 10,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><path d="M0,5 Q5,0 10,5 Q15,10 20,5" fill="none" stroke="white" stroke-width="0.75" stroke-opacity="0.22"/></svg>`,
  },
  {
    key: "stars",
    w: 12, h: 12,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><path d="M6,1.5 L7,5 L10.5,6 L7,7 L6,10.5 L5,7 L1.5,6 L5,5 Z" fill="white" fill-opacity="0.22"/></svg>`,
  },
  {
    key: "plus",
    w: 10, h: 10,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><line x1="5" y1="2" x2="5" y2="8" stroke="white" stroke-width="0.75" stroke-opacity="0.25" stroke-linecap="round"/><line x1="2" y1="5" x2="8" y2="5" stroke="white" stroke-width="0.75" stroke-opacity="0.25" stroke-linecap="round"/></svg>`,
  },
  {
    key: "rings",
    w: 10, h: 10,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="2.5" fill="none" stroke="white" stroke-width="0.75" stroke-opacity="0.25"/></svg>`,
  },
  {
    key: "zigzag",
    w: 16, h: 8,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="8"><polyline points="0,0 8,8 16,0" fill="none" stroke="white" stroke-width="0.75" stroke-opacity="0.2"/></svg>`,
  },
] as const;

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
  textureKey,
  deckName,
  matWidth,
}: {
  rows: ResolvedDeckTile[][];
  cardWidth: number;
  activeGradient: string | null;
  textureKey: string | null;
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

  // Drop shadow drawn before fill so it renders behind the mat shape.
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.66)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 4;
  ctx.beginPath();
  ctx.roundRect(matX, matY, matWidth, matHeight, 12);
  ctx.fillStyle = "#000"; // colour doesn't matter — only shadow is visible
  ctx.fill();
  ctx.restore();

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

  // ── 7. Texture overlay ────────────────────────────────────────────────────
  if (textureKey) {
    const texDef = TEXTURES.find((t) => t.key === textureKey);
    if (texDef) {
      try {
        const patImg = await loadImg(
          `data:image/svg+xml,${encodeURIComponent(texDef.svg)}`,
        );
        const pat = ctx.createPattern(patImg, "repeat");
        if (pat) {
          const ts = matWidth / 600;
          pat.setTransform(new DOMMatrix([ts, 0, 0, ts, 0, 0]));
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(matX, matY, matWidth, matHeight, 12);
          ctx.clip();
          ctx.fillStyle = pat;
          ctx.fillRect(matX, matY, matWidth, matHeight);
          ctx.restore();
        }
      } catch {
        console.warn("[DeckMat] texture pattern failed:", textureKey);
      }
    }
  }

  // ── 8. Card piles ─────────────────────────────────────────────────────────
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

      const cardR = Math.max(2, Math.round(cardWidth * 0.05));
      for (let i = 0; i < count; i++) {
        const cx = pileX + i * cardWidth * FAN_OVERLAP;

        // Card slot background
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(cx, ry, cardWidth, cardH, cardR);
        ctx.closePath();
        ctx.fillStyle = "#e8e8e8";
        ctx.fill();
        ctx.restore();

        // Card image clipped to slot
        if (cardImg) {
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(cx, ry, cardWidth, cardH, cardR);
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
  const [textureKey, setTextureKey] = useState<string | null>(null);
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
      const dataUrl = await rasterizeMat({ rows, cardWidth, activeGradient, textureKey, deckName, matWidth });
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
  const activeTex = TEXTURES.find((t) => t.key === textureKey) ?? null;
  const texScale = matWidth > 0 ? matWidth / 600 : 1;
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
              <span className="text-lg sm:text-xl font-semibold text-text-primary truncate">
                {decks.find((d) => d.id === selectedDeckId)?.name ?? ""}
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo-wordmark.png"
                alt="TCG Dexter"
                width={1920}
                height={453}
                className="h-[27px] sm:h-[30px] w-auto flex-shrink-0"
              />
            </div>

            <div
              className="rounded-xl overflow-hidden"
              style={{
                padding: MAT_PADDING,
                backgroundImage: activeTex
                  ? `url("data:image/svg+xml,${encodeURIComponent(activeTex.svg)}"), ${activeGradient ?? "none"}`
                  : (activeGradient ?? "none"),
                backgroundSize: activeTex
                  ? `${activeTex.w * texScale}px ${activeTex.h * texScale}px, auto`
                  : "auto",
                height: matWidth > 0 ? matWidth * MAT_ASPECT : undefined,
                boxShadow: "0 4px 4px rgba(0,0,0,0.66)",
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

          {/* Color picker */}
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
                style={{ background: gradient }}
              />
            ))}
          </div>

          {/* Texture picker */}
          <div className="flex flex-wrap gap-1.5">
            {TEXTURES.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTextureKey((prev) => (prev === t.key ? null : t.key))}
                aria-label={t.key}
                className={`w-7 h-7 rounded-full transition-all ${
                  textureKey === t.key
                    ? "ring-2 ring-black ring-offset-1 ring-offset-[#f2f2f2] scale-110"
                    : "hover:ring-1 hover:ring-black/25 hover:ring-offset-1 hover:ring-offset-[#f2f2f2]"
                }`}
                style={{
                  backgroundColor: "#3a3a3a",
                  backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(t.svg)}")`,
                  backgroundSize: `${t.w}px ${t.h}px`,
                }}
              />
            ))}
          </div>

          {/* Export button */}
          <button
            type="button"
            onClick={handleExport}
            disabled={!tiles?.length || isExporting}
            className="w-full py-2.5 rounded-full text-sm font-semibold text-white disabled:opacity-40 transition-opacity"
            style={{ background: "var(--gradient-brand)" }}
          >
            {isExporting ? "Exporting…" : "Export"}
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
            <div className="overflow-x-auto -mx-4 px-4 sm:-mx-6 sm:px-6 pb-1">
              <div className="grid grid-rows-2 grid-flow-col gap-2 w-max">
                {decks.map((deck) => {
                  const total = deck.wins + deck.losses + deck.draws;
                  const isSelected = deck.id === selectedDeckId;
                  const isLoading = isSelected && loading;
                  return (
                    <button
                      key={deck.id}
                      type="button"
                      onClick={() => !isLoading && handleSelectDeck(deck)}
                      className={`flex items-center gap-2.5 px-2 py-2 rounded-full border text-left transition ${
                        isSelected
                          ? "bg-black/6 border-black/20"
                          : "bg-white border-black/8 hover:bg-black/4"
                      }`}
                    >
                      <div className="w-10 h-[54px] flex-shrink-0 rounded overflow-hidden bg-surface">
                        {deck.avatarUrl ? (
                          <img src={deck.avatarUrl} alt="" className="w-full h-full object-contain" loading="lazy" />
                        ) : (
                          <div className="w-full h-full bg-surface" />
                        )}
                      </div>
                      <div className="flex flex-col gap-1.5 min-w-0 pr-1">
                        <span className="text-xs font-semibold text-text-primary whitespace-nowrap leading-tight">
                          {deck.name}
                        </span>
                        {total > 0 && (
                          <span className="inline-flex items-baseline tabular-nums font-bold text-[10px] leading-none bg-black rounded-full px-2 py-[3px] text-white self-start whitespace-nowrap">
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
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
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
          className="absolute top-0 overflow-hidden bg-surface"
          style={{
            left: i * cardWidth * FAN_OVERLAP,
            width: cardWidth,
            height: cardHeight,
            borderRadius: Math.max(2, Math.round(cardWidth * 0.05)),
            zIndex: i,
            boxShadow: i > 0 ? "-2px 0 2px rgba(0,0,0,0.33)" : undefined,
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
