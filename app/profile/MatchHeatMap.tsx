/**
 * Match Activity heat map — 20-week GitHub-style grid.
 *
 * Layout: 20 columns × 7 rows (Sun → Sat). Each column is one calendar
 * week. The rightmost column is the current week; days after today are
 * rendered at 0% opacity to preserve the grid shape. Colors come from
 * the Sign-in gradient stops (#F2A20C → #D91E0D → #A60D0D) + opacity.
 */

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

// Heat palette — uses the Sign-in-with-Email / trainer progress gradient stops.
function heatStyle(count: number): React.CSSProperties {
  if (count <= 0) return { backgroundColor: "var(--surface)" };
  if (count === 1) return { backgroundColor: "rgba(242,162,12,0.4)" };   // #F2A20C @ 40%
  if (count === 2) return { backgroundColor: "#F2A20C" };                // gradient start
  if (count === 3) return { backgroundColor: "#D91E0D" };                // gradient middle
  return { backgroundColor: "#A60D0D" };                                 // gradient end (4+)
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

export default function MatchHeatMap({ matches }: { matches: MatchRow[] }) {
  const cells = buildCells(matches);
  const total = cells.reduce((sum, c) => sum + (c.isFuture ? 0 : c.count), 0);

  return (
    <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm p-5 h-full">
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
              ...heatStyle(c.count),
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

      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-text-muted">
          {total} match{total === 1 ? "" : "es"} in window
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-text-muted">Less</span>
          {HEAT_LEVELS.map((lvl) => (
            <span
              key={lvl.label}
              className="w-3 h-3 rounded-[3px]"
              style={heatStyle(lvl.count)}
              title={`${lvl.label} match${lvl.count === 1 ? "" : "es"}`}
            />
          ))}
          <span className="text-xs text-text-muted">More</span>
        </div>
      </div>

      {total === 0 && (
        <p className="mt-3 text-xs text-text-muted">
          Log matches on your deck pages to build your activity map.
        </p>
      )}
    </div>
  );
}
