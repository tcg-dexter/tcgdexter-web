/**
 * Battle Activity heat map — 20-week GitHub-style grid.
 *
 * Layout: 20 columns × 7 rows (Sun → Sat). Each column is one calendar
 * week. The rightmost column is the current week; days after today are
 * rendered at 0% opacity to preserve the grid shape. Colors come from
 * the heat palette resolved against the user's chosen banner accent
 * — brand (default) or one of the 11 energy types.
 */

import { ENERGY_HEX } from "@/app/components/DeckProfileView";
import { shade } from "@/lib/color";

export type BattleRow = {
  played_at: string | null;
  created_at: string;
};

type Cell = {
  key: string;        // YYYY-MM-DD local
  display: string;    // "Apr 12, 2026"
  count: number;
  isFuture: boolean;
};

/** Four heat tiers (used for counts 1, 2, 3, and 4+). Tier 1 is also
 *  used at 40% alpha implicitly via `tier1Alpha` for the lightest cells.
 *  The brand palette keeps the legacy three-stop ramp (orange → red →
 *  dark red); energy accents derive light/mid/dark shades from a single
 *  base hex so each cell still reads as the same hue family as the
 *  banner. */
export type HeatPalette = {
  tier1Alpha: string; // 1 battle: low-density, fades into the surface
  tier2: string;      // 2 battles
  tier3: string;      // 3 battles
  tier4: string;      // 4+ battles
};

const BRAND_HEAT: HeatPalette = {
  tier1Alpha: "rgba(242,162,12,0.4)", // #F2A20C @ 40%
  tier2: "#F2A20C",                   // gradient start
  tier3: "#D91E0D",                   // gradient middle
  tier4: "#A60D0D",                   // gradient end
};

/** Resolve the 4-tier palette for a given banner_accent. NULL or an
 *  unrecognized accent → brand. Energy accents reuse `shade()` to step
 *  the base hue darker for higher counts, mirroring the banner's
 *  top→bottom gradient direction. */
export function heatPalette(accent: string | null): HeatPalette {
  if (!accent) return BRAND_HEAT;
  const hex = ENERGY_HEX[accent];
  if (!hex) return BRAND_HEAT;
  // Hex with 40% alpha for tier-1 — mirrors the brand palette's faded
  // first tier. The 8-bit alpha suffix `66` = 0x66/0xff ≈ 0.4.
  return {
    tier1Alpha: `${hex}66`,
    tier2: hex,
    tier3: shade(hex, -14),
    tier4: shade(hex, -28),
  };
}

export function heatStyle(count: number, palette: HeatPalette): React.CSSProperties {
  if (count <= 0) return { backgroundColor: "var(--surface)" };
  if (count === 1) return { backgroundColor: palette.tier1Alpha };
  if (count === 2) return { backgroundColor: palette.tier2 };
  if (count === 3) return { backgroundColor: palette.tier3 };
  return { backgroundColor: palette.tier4 };
}

const HEAT_LEVELS: { label: string; count: number }[] = [
  { label: "0", count: 0 },
  { label: "1", count: 1 },
  { label: "2", count: 2 },
  { label: "3", count: 3 },
  { label: "4+", count: 4 },
];

const WEEKS = 20;
export const DAYS_PER_WEEK = 7;

/**
 * Build a `weeks`-column × 7-row grid of day cells.
 * Returned order is row-major so children pack naturally into the CSS grid.
 * Row 0 = Sunday, row 6 = Saturday. Rightmost column is the current week.
 *
 * Resolves "today" and every cell key in the RUNTIME's timezone, so where
 * this runs matters: fine in a server component whose HTML is never
 * re-rendered, but a client component would compute one grid on the server
 * and a different one in the browser and mismatch on hydration. Callers on
 * a client surface should precompute server-side — see buildHeatCounts.
 */
function buildCells(battles: BattleRow[], weeks: number): Cell[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayDow = today.getDay(); // 0 = Sun

  // Sunday of the rightmost (current) week
  const rightmostSunday = new Date(today);
  rightmostSunday.setDate(today.getDate() - todayDow);

  // Sunday of the leftmost (oldest) week
  const leftmostSunday = new Date(rightmostSunday);
  leftmostSunday.setDate(rightmostSunday.getDate() - (weeks - 1) * DAYS_PER_WEEK);

  const toKey = (d: Date) => d.toLocaleDateString("en-CA");
  const toDisplay = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  // Count battles per local-date key
  const counts: Record<string, number> = {};
  for (const m of battles) {
    const ts = m.played_at ?? m.created_at;
    if (!ts) continue;
    const key = new Date(ts).toLocaleDateString("en-CA");
    counts[key] = (counts[key] ?? 0) + 1;
  }

  // Emit row-major: for each weekday row (Sun → Sat), walk `weeks` columns left → right.
  const cells: Cell[] = [];
  for (let row = 0; row < DAYS_PER_WEEK; row++) {
    for (let col = 0; col < weeks; col++) {
      const d = new Date(leftmostSunday);
      d.setDate(leftmostSunday.getDate() + col * DAYS_PER_WEEK + row);
      const key = toKey(d);
      cells.push({
        key,
        display: toDisplay(d),
        count: counts[key] ?? 0,
        isFuture: d.getTime() > today.getTime(),
      });
    }
  }

  return cells;
}

/**
 * Row-major counts for a `weeks` × 7 grid, with -1 marking a day later than
 * today (only ever in the rightmost column). Deliberately dates-out: the
 * caller renders from plain numbers, so a client component can show a heat
 * grid without doing any timezone-dependent date maths of its own.
 */
export function buildHeatCounts(battles: BattleRow[], weeks: number): number[] {
  return buildCells(battles, weeks).map((c) => (c.isFuture ? -1 : c.count));
}

/**
 * The grid alone — no card chrome, no heading, no per-day tooltips. Takes
 * counts rather than battles so it stays safe to render from a client
 * component (see buildHeatCounts). Sizing is the caller's: the cells are
 * square and fill whatever box they're given.
 *
 * The column count is derived from `counts` rather than passed in. It used
 * to be a prop, with the caller and whoever built the counts each holding
 * their own copy of the number — and when those two disagreed the grid
 * still rendered, just wrong, which is exactly the failure that shipped:
 * a 7-column template with nothing in it. One source, no way to disagree.
 */
export function BattleHeatGrid({
  counts,
  accent = null,
  gapPx = 4,
  cellRadiusClass = "rounded-[4px]",
  emptyColor = "var(--surface)",
  heightPx,
  label,
}: {
  /** Row-major, from buildHeatCounts. Length must be a multiple of 7. */
  counts: number[];
  accent?: string | null;
  /** Gap between cells, in px — a number rather than a Tailwind class
   *  because `heightPx` has to do arithmetic with it. */
  gapPx?: number;
  cellRadiusClass?: string;
  /** Tone for a day with no battles. The default reads against an elevated
   *  white/surface card; a caller painting on a different surface has to
   *  say so, or its empty cells vanish into the background. */
  emptyColor?: string;
  /**
   * Size the grid to a target HEIGHT instead of letting it fill its
   * container's width.
   *
   * Cells are square and there are always 7 rows, so height and width
   * aren't independent: fixing one fixes the other at
   * `weeks/7` times it, near enough. A caller that needs a particular
   * height therefore can't also choose the width — pass this and the grid
   * takes exactly the width its square cells imply, rather than stretching
   * to the container and getting taller than asked.
   */
  heightPx?: number;
  /** Describes the grid as a whole; the cells are decorative on their own. */
  label?: string;
}) {
  if (counts.length === 0) return null;
  const weeks = Math.max(1, Math.round(counts.length / DAYS_PER_WEEK));
  const palette = heatPalette(accent);

  // 7 rows of `cell` plus 6 gaps make up the height; the width follows from
  // the same cell across `weeks` columns. Left undefined, the grid fills
  // its container's width instead and the height falls out of that.
  const width =
    heightPx == null
      ? undefined
      : ((heightPx - (DAYS_PER_WEEK - 1) * gapPx) / DAYS_PER_WEEK) * weeks +
        (weeks - 1) * gapPx;

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))`,
        gap: gapPx,
        width,
      }}
      role="img"
      aria-label={label}
      title={label}
    >
      {counts.map((count, i) => (
        <div
          key={i}
          className={`aspect-square ${cellRadiusClass}`}
          style={{
            ...heatStyle(count, palette),
            ...(count === 0 ? { backgroundColor: emptyColor } : null),
            // -1 is a day that hasn't happened yet. It holds its place in
            // the grid rather than being dropped, so the shape stays square.
            ...(count < 0 ? { opacity: 0 } : null),
          }}
        />
      ))}
    </div>
  );
}

export default function BattleHeatMap({
  battles,
  accent = null,
}: {
  battles: BattleRow[];
  /** profiles.banner_accent — drives the heat palette so the module
   *  reads as the same theme as the page banner. */
  accent?: string | null;
}) {
  const cells = buildCells(battles, WEEKS);
  const total = cells.reduce((sum, c) => sum + (c.isFuture ? 0 : c.count), 0);
  const palette = heatPalette(accent);

  return (
    <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-semibold text-text-primary">Battle Activity</h2>
        <span className="text-xs text-text-muted">Last 20 weeks</span>
      </div>

      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${WEEKS}, minmax(0, 1fr))` }}>
        {cells.map((c) => (
          <div
            key={c.key}
            className="aspect-square rounded-[4px]"
            style={{
              ...heatStyle(c.count, palette),
              ...(c.isFuture ? { opacity: 0 } : null),
            }}
            title={
              c.isFuture
                ? c.display
                : `${c.count} battle${c.count === 1 ? "" : "s"} on ${c.display}`
            }
          />
        ))}
      </div>

    </div>
  );
}
