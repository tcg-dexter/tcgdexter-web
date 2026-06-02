/**
 * Match Activity heat map — 20-week GitHub-style grid.
 *
 * Layout: 20 columns × 7 rows (Sun → Sat). Each column is one calendar
 * week. The rightmost column is the current week; days after today are
 * rendered at 0% opacity to preserve the grid shape. Colors come from
 * the heat palette resolved against the user's chosen banner accent
 * — brand (default) or one of the 11 energy types.
 */

import { ENERGY_HEX } from "@/app/components/DeckProfileView";
import { shade } from "@/lib/color";

type MatchRow = {
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
type HeatPalette = {
  tier1Alpha: string; // 1 match: low-density, fades into the surface
  tier2: string;      // 2 matches
  tier3: string;      // 3 matches
  tier4: string;      // 4+ matches
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
function heatPalette(accent: string | null): HeatPalette {
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

function heatStyle(count: number, palette: HeatPalette): React.CSSProperties {
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
const DAYS_PER_WEEK = 7;

/**
 * Build a WEEKS-column × 7-row grid of day cells.
 * Returned order is row-major so children pack naturally into the CSS grid.
 * Row 0 = Sunday, row 6 = Saturday. Rightmost column is the current week.
 */
function buildCells(matches: MatchRow[]): Cell[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayDow = today.getDay(); // 0 = Sun

  // Sunday of the rightmost (current) week
  const rightmostSunday = new Date(today);
  rightmostSunday.setDate(today.getDate() - todayDow);

  // Sunday of the leftmost (oldest) week
  const leftmostSunday = new Date(rightmostSunday);
  leftmostSunday.setDate(rightmostSunday.getDate() - (WEEKS - 1) * DAYS_PER_WEEK);

  const toKey = (d: Date) => d.toLocaleDateString("en-CA");
  const toDisplay = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  // Count matches per local-date key
  const counts: Record<string, number> = {};
  for (const m of matches) {
    const ts = m.played_at ?? m.created_at;
    if (!ts) continue;
    const key = new Date(ts).toLocaleDateString("en-CA");
    counts[key] = (counts[key] ?? 0) + 1;
  }

  // Emit row-major: for each weekday row (Sun → Sat), walk WEEKS columns left → right.
  const cells: Cell[] = [];
  for (let row = 0; row < DAYS_PER_WEEK; row++) {
    for (let col = 0; col < WEEKS; col++) {
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

export default function MatchHeatMap({
  matches,
  accent = null,
}: {
  matches: MatchRow[];
  /** profiles.banner_accent — drives the heat palette so the module
   *  reads as the same theme as the page banner. */
  accent?: string | null;
}) {
  const cells = buildCells(matches);
  const total = cells.reduce((sum, c) => sum + (c.isFuture ? 0 : c.count), 0);
  const palette = heatPalette(accent);

  return (
    <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-semibold text-text-primary">Match Activity</h2>
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
                : `${c.count} match${c.count === 1 ? "" : "es"} on ${c.display}`
            }
          />
        ))}
      </div>

    </div>
  );
}
