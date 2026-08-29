"use client";

import { useId, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { PricePoint } from "@/lib/priceHistory";

const WIDTH = 800;
const HEIGHT = 220;
const PAD_X = 4;
const PAD_TOP = 20;
const PAD_BOTTOM = 12;

type Range = "7d" | "30d" | "60d" | "90d";

// A tier is offered once there's more data than the previous tier's day
// count — e.g. 30D only shows up once there's more than a week of history,
// mirroring how a single card can be too new to have earned longer tiers.
const RANGE_TIERS: Array<{ range: Range; days: number; threshold: number }> = [
  { range: "7d", days: 7, threshold: 0 },
  { range: "30d", days: 30, threshold: 7 },
  { range: "60d", days: 60, threshold: 30 },
  { range: "90d", days: 90, threshold: 60 },
];

function formatCurrency(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return abs >= 1000 ? `${sign}$${Math.round(abs).toLocaleString()}` : `${sign}$${abs.toFixed(2)}`;
}

function formatDateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Market-price line chart for a single printing, above "More by {artist}"
 * on the card detail page. Pointer events unify mouse hover (desktop) and
 * touch drag (mobile) into one handler — dragging a finger across the chart
 * scrubs through days exactly like hovering with a cursor does.
 */
export default function PriceHistoryChart({ points }: { points: PricePoint[] }) {
  const [range, setRange] = useState<Range>("7d");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const gradientId = useId();

  const availableRanges = useMemo(
    () => RANGE_TIERS.filter((t) => points.length > t.threshold).map((t) => t.range),
    [points]
  );

  const rangeDays = RANGE_TIERS.find((t) => t.range === range)?.days ?? 7;

  const visible = useMemo(() => {
    return points.slice(Math.max(0, points.length - rangeDays));
  }, [points, rangeDays]);

  const prices = visible.map((p) => p.price);
  const min = prices.length ? Math.min(...prices) : 0;
  const max = prices.length ? Math.max(...prices) : 0;
  const span = max - min || 1;

  const stepX = visible.length > 1 ? (WIDTH - PAD_X * 2) / (visible.length - 1) : 0;
  const xFor = (i: number) => PAD_X + i * stepX;
  const yFor = (price: number) =>
    PAD_TOP + (1 - (price - min) / span) * (HEIGHT - PAD_TOP - PAD_BOTTOM);

  const linePoints = visible.map((p, i) => `${xFor(i).toFixed(1)},${yFor(p.price).toFixed(1)}`).join(" ");
  const areaPoints =
    visible.length > 1
      ? `${PAD_X},${HEIGHT - PAD_BOTTOM} ${linePoints} ${xFor(visible.length - 1).toFixed(1)},${HEIGHT - PAD_BOTTOM}`
      : "";

  if (points.length < 2) return null;

  const first = visible[0];
  const last = visible[visible.length - 1];
  const delta = last.price - first.price;
  const deltaPct = first.price !== 0 ? (delta / first.price) * 100 : 0;
  const isFlat = Math.abs(delta) < 0.005;
  // Rightmost value above leftmost → green; flat or down keeps the red.
  const isUp = last.price > first.price;
  const lineColor = isUp ? "#16a34a" : "#dc2626";
  const deltaColor = isFlat
    ? "text-text-muted"
    : isUp
      ? "text-green-600 dark:text-green-500"
      : "text-red-600 dark:text-red-500";

  function updateHover(clientX: number, target: SVGSVGElement) {
    if (visible.length === 0) return;
    const rect = target.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const x = ratio * WIDTH;
    let closest = 0;
    let closestDist = Infinity;
    for (let i = 0; i < visible.length; i++) {
      const d = Math.abs(xFor(i) - x);
      if (d < closestDist) {
        closestDist = d;
        closest = i;
      }
    }
    setHoverIndex(closest);
  }

  function handlePointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    updateHover(e.clientX, e.currentTarget);
  }

  function handlePointerLeave() {
    setHoverIndex(null);
  }

  return (
    <section className="mt-10 rounded-2xl p-[1.5px] bg-gradient-to-r from-neutral-300 to-neutral-500 dark:from-neutral-600 dark:to-neutral-400 shadow-sm">
      <div className="rounded-[14.5px] bg-white/95 dark:bg-surface-elevated backdrop-blur-xl p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Price History</h2>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-text-primary tabular-nums">
                {formatCurrency(last.price)}
              </span>
              {!isFlat ? (
                <span className={`text-sm font-semibold tabular-nums ${deltaColor}`}>
                  {isUp ? "+" : ""}
                  {formatCurrency(delta)} ({isUp ? "+" : ""}
                  {deltaPct.toFixed(1)}%)
                </span>
              ) : (
                <span className="text-sm font-medium text-text-muted">No change</span>
              )}
            </div>
            <p className="text-xs text-text-muted mt-0.5">
              {formatDateLabel(last.date)} · latest
            </p>
          </div>

          {availableRanges.length > 1 && (
            <div
              className="relative flex items-center h-[30px] rounded-full bg-black/5 dark:bg-white/5 p-[3px] self-start"
              role="tablist"
            >
              <div
                aria-hidden
                className="absolute inset-y-[3px] left-[3px] rounded-full bg-black dark:bg-white shadow-sm transition-transform duration-300 ease-in-out"
                style={{
                  width: `calc(${100 / availableRanges.length}% - 3px)`,
                  transform: `translateX(${availableRanges.indexOf(range) * 100}%)`,
                }}
              />
              {availableRanges.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="tab"
                  aria-selected={range === r}
                  onClick={() => {
                    setRange(r);
                    setHoverIndex(null);
                  }}
                  className={`relative z-10 h-full flex-1 flex items-center justify-center px-3.5 rounded-full text-xs font-bold transition-colors ${
                    range === r ? "text-white dark:text-black" : "text-text-muted"
                  }`}
                >
                  {r.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative mt-4 -mx-1">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="none"
            className="w-full h-[160px] sm:h-[200px] touch-none cursor-crosshair"
            role="img"
            aria-label={`Market price over the last ${rangeDays} days, from ${formatCurrency(min)} to ${formatCurrency(max)}`}
            onPointerMove={handlePointerMove}
            onPointerDown={handlePointerMove}
            onPointerLeave={handlePointerLeave}
            onPointerUp={handlePointerLeave}
            onPointerCancel={handlePointerLeave}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lineColor} stopOpacity="0.28" />
                <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
              </linearGradient>
            </defs>

            {areaPoints && <polygon points={areaPoints} fill={`url(#${gradientId})`} />}

            {visible.length > 1 ? (
              <polyline
                points={linePoints}
                fill="none"
                stroke={lineColor}
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : (
              <circle cx={WIDTH / 2} cy={HEIGHT / 2} r="4" fill={lineColor} />
            )}

            {hoverIndex !== null && visible[hoverIndex] && (
              <>
                <line
                  x1={xFor(hoverIndex)}
                  x2={xFor(hoverIndex)}
                  y1={PAD_TOP}
                  y2={HEIGHT - PAD_BOTTOM}
                  stroke="var(--border)"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                <circle
                  cx={xFor(hoverIndex)}
                  cy={yFor(visible[hoverIndex].price)}
                  r="5"
                  fill={lineColor}
                  stroke="var(--surface-elevated)"
                  strokeWidth="2"
                />
              </>
            )}
          </svg>

          {hoverIndex !== null && visible[hoverIndex] && (
            <div
              className="absolute -translate-x-1/2 -translate-y-full pb-2 pointer-events-none z-20"
              style={{
                left: `${(xFor(hoverIndex) / WIDTH) * 100}%`,
                top: `${(PAD_TOP / HEIGHT) * 100}%`,
              }}
            >
              <div className="rounded-lg border border-black/8 dark:border-white/10 bg-white dark:bg-surface-elevated shadow-md px-2.5 py-1.5 text-center whitespace-nowrap">
                <div className="text-sm font-bold text-text-primary tabular-nums">
                  {formatCurrency(visible[hoverIndex].price)}
                </div>
                <div className="text-[10px] text-text-muted mt-0.5">
                  {formatDateLabel(visible[hoverIndex].date)}
                </div>
              </div>
            </div>
          )}

          {visible.length > 1 && (
            <div className="flex justify-between text-[11px] text-text-muted mt-1 px-1">
              <span>{formatDateLabel(visible[0].date)}</span>
              <span>{formatDateLabel(visible[visible.length - 1].date)}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
