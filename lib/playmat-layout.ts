/**
 * Pure Playmat layout primitives — shared by the interactive mat
 * (app/admin-tools/deck-mat/DeckMatClient) and the server-side email
 * renderer (lib/email/playmat-render). No React/DOM here so it's safe to
 * import from a Node script.
 */
import type { ResolvedDeckTile } from "@/lib/deckTiles";

export const FAN_OVERLAP = 0.2;
export const ROW_GAP_X = 6;
export const MAX_PILES_PER_ROW = 8;
export const MAX_ROWS = 4;
export const MAT_PADDING = 8;
export const MAT_ASPECT = 14 / 24;

// Real card (2.5in) as a proportion of the real mat (24in) — the card width
// this yields is the true-to-scale size, independent of how many piles are
// on the mat. computeCardWidth() only shrinks below this to keep a crowded
// mat from overflowing; it never grows cards past it.
const CARD_WIDTH_IN = 2.5;
const MAT_WIDTH_IN = 24;
export const TRUE_SCALE_CARD_RATIO = CARD_WIDTH_IN / MAT_WIDTH_IN;

/** Chunk tiles into rows of at most MAX_PILES_PER_ROW, capped at MAX_ROWS. */
export function computeRows(tiles: ResolvedDeckTile[]): ResolvedDeckTile[][] {
  const rows: ResolvedDeckTile[][] = [];
  for (let i = 0; i < tiles.length && rows.length < MAX_ROWS; i += MAX_PILES_PER_ROW) {
    rows.push(tiles.slice(i, i + MAX_PILES_PER_ROW));
  }
  return rows;
}

/** The card width (px) that fits every row within the mat's inner box. */
export function computeCardWidth(
  rows: ResolvedDeckTile[][],
  containerWidth: number,
): number {
  if (!rows.length || containerWidth === 0) return 60;
  const innerW = containerWidth - MAT_PADDING * 2;
  const innerH = containerWidth * MAT_ASPECT - MAT_PADDING * 2;

  // True-to-scale width: cards are a fixed proportion of the mat (real
  // 2.5in card on a real 24in mat), so this is the size regardless of how
  // many piles end up on the mat.
  const trueScaleWidth = containerWidth * TRUE_SCALE_CARD_RATIO;

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
  // True scale is the ceiling — only shrink below it when a crowded mat
  // would otherwise overflow.
  return Math.floor(Math.min(trueScaleWidth, minCardWidth));
}

// The swatch picker's color:texture column split — 4 columns of colors for
// every 2 of textures. Column count is always a multiple of this pair so
// the split stays exact at any size.
const SWATCH_COLOR_COL_UNITS = 4;
const SWATCH_TEXTURE_COL_UNITS = 2;
const SWATCH_DEFAULT = { cols: 6, colorCols: 4, textureCols: 2 };

/**
 * Picks how many columns the swatch grid should use, given the box it has
 * to fill and how many color/texture swatches it holds. 6 columns (4 + 2)
 * is the baseline; when the box is short relative to its width — e.g. the
 * mat (and so this panel) is short on a narrow mobile viewport — more
 * columns means fewer rows, which means taller, better-proportioned
 * swatches instead of a wide grid of squashed-flat ones. Tries multiples
 * of the 4:2 split and keeps whichever produces the largest square-ish
 * cell, so it only grows past 6 columns when doing so actually makes the
 * swatches bigger.
 */
export function computeSwatchColumns(
  containerW: number,
  containerH: number,
  colorCount: number,
  textureCount: number,
): { cols: number; colorCols: number; textureCols: number } {
  if (containerW <= 0 || containerH <= 0) return SWATCH_DEFAULT;

  let best = SWATCH_DEFAULT;
  let bestScore = -Infinity;
  for (let k = 1; k <= 10; k++) {
    const colorCols = SWATCH_COLOR_COL_UNITS * k;
    const textureCols = SWATCH_TEXTURE_COL_UNITS * k;
    const rows = Math.max(
      Math.ceil(colorCount / colorCols),
      Math.ceil(textureCount / textureCols),
    );
    const cellW = containerW / (colorCols + textureCols);
    const cellH = containerH / rows;
    const score = Math.min(cellW, cellH);
    if (score > bestScore) {
      bestScore = score;
      best = { cols: colorCols + textureCols, colorCols, textureCols };
    }
  }
  return best;
}
