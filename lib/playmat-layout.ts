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
// Piles batch into fans of at most BOUQUET_GROUP_SIZE, restarting the batch
// whenever the "kind" of card changes — a Pokémon's evolution family, a
// trainer's subtype (tools with tools, supporters with supporters), or
// energy — rather than cutting blindly every 4 tiles regardless of what
// they are (see bouquetGroups). Each fan curves its piles by both rotating
// them and spreading their pivots apart — pure shared-pivot rotation alone
// left adjacent piles almost fully overlapped near the base. Fans then
// wrap into rows the same way Grid's piles do, searching for the
// fans-per-row that yields the largest card.
export const BOUQUET_GROUP_SIZE = 4;
export const BOUQUET_ANGLE_STEP_DEG = 10;
// Pivot spacing between adjacent piles, as a fraction of cardWidth — the
// main fix for the overlap the pure-rotation version had.
const BOUQUET_SPREAD_RATIO = 0.55;
// Parabolic pivot rise for the outer piles of a fan, as a fraction of
// cardWidth at the extremes — a gentle "bouquet" arc rather than a flat
// line of pivots.
const BOUQUET_LIFT_RATIO = 0.15;
const CARD_ASPECT = 342 / 245; // card height / width

/** Cluster key a tile batches by for the Bouquet layout: a Pokémon's whole
 *  evolution family together, a trainer's own subtype together, or energy
 *  (tiles already arrive grouped this way — resolveDeckTiles' orderTiles —
 *  so this only needs to notice where the "kind" changes, not resort
 *  anything). */
function bouquetClusterKey(t: ResolvedDeckTile): string {
  if (t.section === "pokemon") return `pokemon:${t.family ?? t.name.toLowerCase()}`;
  if (t.section === "trainer") return `trainer:${t.subtype ?? "Other"}`;
  return "energy";
}

/** Batches tiles into same-kind fans of at most BOUQUET_GROUP_SIZE — e.g.
 *  a run of 6 energy becomes fans of 4 and 2, but a run of 3 supporters
 *  followed by 5 items becomes fans of [3 supporters], [4 items], [1 item]
 *  rather than a fan mixing supporters and items. */
function bouquetGroups(tiles: ResolvedDeckTile[]): ResolvedDeckTile[][] {
  const groups: ResolvedDeckTile[][] = [];
  let key: string | null = null;
  let current: ResolvedDeckTile[] = [];
  for (const t of tiles) {
    const k = bouquetClusterKey(t);
    if (k !== key || current.length >= BOUQUET_GROUP_SIZE) {
      if (current.length) groups.push(current);
      current = [];
      key = k;
    }
    current.push(t);
  }
  if (current.length) groups.push(current);
  return groups;
}

interface BouquetPilePlacement {
  /** Pile position within the fan's own box, in cardWidth units — multiply
   *  by cardWidth for px. The pile's bottom-center sits at this point. */
  x: number;
  y: number;
  angle: number; // degrees
}

/**
 * A fan's full layout in cardWidth units: every pile's own pivot (where its
 * bottom-center sits — see BouquetFan/rasterizeMat, both of which rotate a
 * pile around exactly this point) and the fan's overall bounding box, which
 * is the true union of every pile's rotated corners (not an approximation
 * — with per-pile pivots now spread apart rather than sharing one point, a
 * single "widest pile" stand-in could under-count the real footprint).
 * Shared by computeBouquetArrangement's search and the live/canvas
 * renderers so a fan's actual drawn footprint always matches what it was
 * sized for.
 */
function bouquetLayout(group: ResolvedDeckTile[]): {
  placements: BouquetPilePlacement[];
  wUnits: number;
  hUnits: number;
} {
  const n = group.length;
  const center = (n - 1) / 2;
  const piles = group.map((t, i) => {
    const footprintUnits = 1 + (Math.max(t.copyCount, 1) - 1) * FAN_OVERLAP;
    const angleDeg = (i - center) * BOUQUET_ANGLE_STEP_DEG;
    const norm = center > 0 ? (i - center) / center : 0;
    return {
      a: footprintUnits / 2, // pile half-width, in cardWidth units
      angleDeg,
      angleRad: (angleDeg * Math.PI) / 180,
      pivotX: (i - center) * BOUQUET_SPREAD_RATIO,
      pivotY: -BOUQUET_LIFT_RATIO * norm * norm, // negative = risen above baseline
    };
  });

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of piles) {
    // Corners of the pile's box (half-width a, height CARD_ASPECT) in its
    // own pre-rotation frame, relative to its bottom-center pivot.
    const corners: [number, number][] = [
      [p.a, 0],
      [-p.a, 0],
      [p.a, -CARD_ASPECT],
      [-p.a, -CARD_ASPECT],
    ];
    const s = Math.sin(p.angleRad);
    const c = Math.cos(p.angleRad);
    for (const [cx, cy] of corners) {
      const x = p.pivotX + (cx * c - cy * s);
      const y = p.pivotY + (cx * s + cy * c);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  return {
    placements: piles.map((p) => ({ x: p.pivotX - minX, y: p.pivotY - minY, angle: p.angleDeg })),
    wUnits: maxX - minX,
    hUnits: maxY - minY,
  };
}

/** A fan's rendered layout in pixels, for a given cardWidth: its overall
 *  box size, and every pile's pivot position (relative to that box's own
 *  top-left) and rotation angle. Shared by the live render and
 *  rasterizeMat so a fan's actual drawn footprint always matches what
 *  computeBouquetArrangement sized it for. */
export function bouquetGroupLayout(
  group: ResolvedDeckTile[],
  cardWidth: number,
): { width: number; height: number; placements: { left: number; top: number; angle: number }[] } {
  const { placements, wUnits, hUnits } = bouquetLayout(group);
  return {
    width: wUnits * cardWidth,
    height: hUnits * cardWidth,
    placements: placements.map((p) => ({ left: p.x * cardWidth, top: p.y * cardWidth, angle: p.angle })),
  };
}

export function computeBouquetArrangement(
  tiles: ResolvedDeckTile[],
  containerWidth: number,
): { rows: ResolvedDeckTile[][][]; cardWidth: number } {
  if (!tiles.length || containerWidth === 0) return { rows: [[tiles]], cardWidth: 60 };
  const innerW = containerWidth - MAT_PADDING * 2;
  const innerH = containerWidth * MAT_ASPECT - MAT_PADDING * 2;
  const trueScaleWidth = containerWidth * TRUE_SCALE_CARD_RATIO;

  const groups = bouquetGroups(tiles);
  const boxUnits = groups.map((g) => bouquetLayout(g));

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
