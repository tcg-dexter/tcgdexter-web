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
// mat from overflowing; it never grows cards past it. CARD_SCALE_BUMP nudges
// that baseline up 5% past strict true-to-scale.
const CARD_WIDTH_IN = 2.5;
const MAT_WIDTH_IN = 24;
const CARD_SCALE_BUMP = 1.05;
export const TRUE_SCALE_CARD_RATIO = (CARD_WIDTH_IN / MAT_WIDTH_IN) * CARD_SCALE_BUMP;

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

/**
 * Row-major grid that searches for the column count yielding the largest
 * card, rather than Standard's fixed MAX_PILES_PER_ROW/MAX_ROWS cap — used
 * by the "Grid" layout. Reuses computeCardWidth as the fitness function for
 * each candidate column count, so the two stay in lockstep by construction.
 */
export function computeGridArrangement(
  tiles: ResolvedDeckTile[],
  containerWidth: number,
): { rows: ResolvedDeckTile[][]; cardWidth: number } {
  if (!tiles.length || containerWidth === 0) return { rows: [], cardWidth: 60 };

  let best: { rows: ResolvedDeckTile[][]; cardWidth: number } = { rows: [tiles], cardWidth: 0 };
  for (let cols = 1; cols <= tiles.length; cols++) {
    const rows: ResolvedDeckTile[][] = [];
    for (let i = 0; i < tiles.length; i += cols) rows.push(tiles.slice(i, i + cols));
    const cardWidth = computeCardWidth(rows, containerWidth);
    if (cardWidth > best.cardWidth) best = { rows, cardWidth };
  }
  return best;
}

/**
 * Column-major arrangement — tiles fill top-to-bottom before wrapping to
 * the next column, instead of Standard's left-to-right-then-down. Since
 * resolveDeckTiles already orders tiles Pokémon lines → Trainers by
 * subtype → Energy, filling down first clusters each category into its
 * own column(s), echoing a hand-sorted playmat's grouped columns — used by
 * the "Columns" layout.
 *
 * A column's width has to fit its widest pile (a multi-copy pile fans out
 * wider than one card — see FAN_OVERLAP), not just one card width, or a
 * tall pile would overlap the next column. So unlike computeGridArrangement
 * this can't just delegate to computeCardWidth (which sums pile widths
 * across a *row*); it sums each column's max pile-width instead.
 */
export function computeColumnsArrangement(
  tiles: ResolvedDeckTile[],
  containerWidth: number,
): { columns: ResolvedDeckTile[][]; cardWidth: number } {
  if (!tiles.length || containerWidth === 0) return { columns: [], cardWidth: 60 };
  const innerW = containerWidth - MAT_PADDING * 2;
  const innerH = containerWidth * MAT_ASPECT - MAT_PADDING * 2;
  const trueScaleWidth = containerWidth * TRUE_SCALE_CARD_RATIO;

  let best: { columns: ResolvedDeckTile[][]; cardWidth: number } = { columns: [tiles], cardWidth: 0 };
  for (let rowsPerCol = 1; rowsPerCol <= tiles.length; rowsPerCol++) {
    const columns: ResolvedDeckTile[][] = [];
    for (let i = 0; i < tiles.length; i += rowsPerCol) columns.push(tiles.slice(i, i + rowsPerCol));

    const maxCardH = (innerH - (rowsPerCol - 1) * ROW_GAP_X) / rowsPerCol;
    if (maxCardH <= 0) continue;
    const maxWidthFromHeight = maxCardH * (245 / 342);

    const widthUnits = columns.reduce((sum, col) => {
      const maxCopy = Math.max(1, ...col.map((t) => t.copyCount));
      return sum + 1 + (maxCopy - 1) * FAN_OVERLAP;
    }, 0);
    const gaps = (columns.length - 1) * ROW_GAP_X;
    const maxWidthFromWidth = (innerW - gaps) / widthUnits;

    const cardWidth = Math.floor(Math.min(trueScaleWidth, maxWidthFromHeight, maxWidthFromWidth));
    if (cardWidth > best.cardWidth) best = { columns, cardWidth };
  }
  return best;
}

// ── "Bouquet" layout ─────────────────────────────────────────────────────
// Piles are batched into fans of at most BOUQUET_GROUP_SIZE (in tile order,
// so e.g. a run of 6 energy becomes two fans of 4 and 2), each fan curving
// its piles around a single shared pivot at every pile's own bottom-center
// — CSS/canvas rotation around that point alone spreads the tops apart
// while the bases stay together, like a hand of cards or a bouquet's
// stems, with no manual per-pile offset math needed. Fans then wrap into
// rows the same way Grid's piles do, searching for the fans-per-row that
// yields the largest card.
export const BOUQUET_GROUP_SIZE = 4;
export const BOUQUET_ANGLE_STEP_DEG = 12;
const CARD_ASPECT = 342 / 245; // card height / width

/** Rotation angles (degrees), symmetric around 0, for a fan of n piles. */
export function bouquetAngles(n: number): number[] {
  return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * BOUQUET_ANGLE_STEP_DEG);
}

/**
 * A fan's bounding box in cardWidth units — the union of every pile's
 * rotated corners, approximated with the fan's single widest pile (by
 * fan-out footprint, see FAN_OVERLAP) at its single widest angle. The
 * exact per-pile union would need a distinct trig term per pile for no
 * real visual benefit here, since this only feeds a "big enough box"
 * check, not a tight fit.
 */
function bouquetBoxUnits(group: ResolvedDeckTile[]): { wUnits: number; hUnits: number } {
  const maxFootprintUnits = Math.max(
    ...group.map((t) => 1 + (Math.max(t.copyCount, 1) - 1) * FAN_OVERLAP),
  );
  const maxA = maxFootprintUnits / 2;
  const maxAngleRad = (Math.max(...bouquetAngles(group.length).map(Math.abs)) * Math.PI) / 180;
  const s = Math.sin(maxAngleRad);
  const c = Math.cos(maxAngleRad);
  // A box of half-width a and height h, rotated by θ around its own
  // bottom-center, has bounding width 2(a·cosθ + h·sinθ) and bounding
  // height 2a·sinθ + h·cosθ (derived from rotating all four corners about
  // that pivot). At θ=0 this correctly degenerates to the plain (2a, h)
  // box — a group of one un-rotated pile.
  return {
    wUnits: 2 * (maxA * c + CARD_ASPECT * s),
    hUnits: 2 * maxA * s + CARD_ASPECT * c,
  };
}

/** A fan's rendered box size in pixels, for a given cardWidth. Shared by
 *  the live render and rasterizeMat so a fan's actual drawn footprint
 *  always matches what computeBouquetArrangement sized it for. */
export function bouquetGroupBox(
  group: ResolvedDeckTile[],
  cardWidth: number,
): { width: number; height: number } {
  const { wUnits, hUnits } = bouquetBoxUnits(group);
  return { width: wUnits * cardWidth, height: hUnits * cardWidth };
}

export function computeBouquetArrangement(
  tiles: ResolvedDeckTile[],
  containerWidth: number,
): { rows: ResolvedDeckTile[][][]; cardWidth: number } {
  if (!tiles.length || containerWidth === 0) return { rows: [[tiles]], cardWidth: 60 };
  const innerW = containerWidth - MAT_PADDING * 2;
  const innerH = containerWidth * MAT_ASPECT - MAT_PADDING * 2;
  const trueScaleWidth = containerWidth * TRUE_SCALE_CARD_RATIO;

  const groups: ResolvedDeckTile[][] = [];
  for (let i = 0; i < tiles.length; i += BOUQUET_GROUP_SIZE) {
    groups.push(tiles.slice(i, i + BOUQUET_GROUP_SIZE));
  }
  const boxUnits = groups.map(bouquetBoxUnits);

  let best: { rows: ResolvedDeckTile[][][]; cardWidth: number } = { rows: [groups], cardWidth: 0 };
  for (let perRow = 1; perRow <= groups.length; perRow++) {
    const rows: ResolvedDeckTile[][][] = [];
    const rowBoxes: { wUnits: number; hUnits: number }[][] = [];
    for (let i = 0; i < groups.length; i += perRow) {
      rows.push(groups.slice(i, i + perRow));
      rowBoxes.push(boxUnits.slice(i, i + perRow));
    }

    let widthConstraint = Infinity;
    let totalHeightUnits = 0;
    for (const rowBox of rowBoxes) {
      const rowWidthUnits = rowBox.reduce((sum, b) => sum + b.wUnits, 0);
      const gaps = (rowBox.length - 1) * ROW_GAP_X;
      widthConstraint = Math.min(widthConstraint, (innerW - gaps) / rowWidthUnits);
      totalHeightUnits += Math.max(...rowBox.map((b) => b.hUnits));
    }
    const gapsY = (rows.length - 1) * ROW_GAP_X;
    const heightConstraint = (innerH - gapsY) / totalHeightUnits;

    const cardWidth = Math.floor(Math.min(trueScaleWidth, widthConstraint, heightConstraint));
    if (cardWidth > best.cardWidth) best = { rows, cardWidth };
  }
  return best;
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
