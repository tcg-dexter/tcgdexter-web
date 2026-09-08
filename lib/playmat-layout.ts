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
