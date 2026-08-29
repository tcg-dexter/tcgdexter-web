"use client";

import { useId, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { PricePoint } from "@/lib/priceHistory";

const WIDTH = 800;
const HEIGHT = 220;
const PAD_X = 4;
const PAD_TOP = 20;
const PAD_BOTTOM = 12;

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
  const [range, setRange] = useState<"7d" | "30d">("7d");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const gradientId = useId();

  const visible = useMemo(() => {
    const n = range === "7d" ? 7 : 30;
    return points.slice(Math.max(0, points.length - n));
  }, [points, range]);

  const canShow30d = points.length > 7;

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
  const isUp = delta > 0;
  const deltaColor = isFlat
    ? "text-text-muted"
    : isUp
      ? "text-green-600 dark:text-green-500"
      : "text-red-600 dark:text-red-500";

  const active = hoverIndex !== null ? visible[hoverIndex] : last;

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
    <section className="mt-10 rounded-2xl p-[1.5px] bg-gradient-brand shadow-sm">
      <div className="rounded-[14.5px] bg-white/95 dark:bg-surface-elevated backdrop-blur-xl p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Price History</h2>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-text-primary tabular-nums">
                {formatCurrency(active.price)}
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
              {formatDateLabel(active.date)}
              {hoverIndex === null && " · latest"}
            </p>
          </div>

          {canShow30d && (
            <div className="inline-flex rounded-full bg-surface-2 p-1 self-start">
              {(["7d", "30d"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setRange(r);
                    setHoverIndex(null);
                  }}
                  className={`px-3 py-1 text-xs font-semibold rounded-full transition-colors ${
                    range === r
                      ? "bg-accent text-white shadow-sm"
                      : "text-text-secondary hover:text-text-primary"
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
            aria-label={`Market price over the last ${range === "7d" ? "7" : "30"} days, from ${formatCurrency(min)} to ${formatCurrency(max)}`}
            onPointerMove={handlePointerMove}
            onPointerDown={handlePointerMove}
            onPointerLeave={handlePointerLeave}
            onPointerUp={handlePointerLeave}
            onPointerCancel={handlePointerLeave}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>

            {areaPoints && <polygon points={areaPoints} fill={`url(#${gradientId})`} />}

            {visible.length > 1 ? (
              <polyline
                points={linePoints}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : (
              <circle cx={WIDTH / 2} cy={HEIGHT / 2} r="4" fill="var(--accent)" />
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
                  fill="var(--accent)"
                  stroke="var(--surface-elevated)"
                  strokeWidth="2"
                />
              </>
            )}
          </svg>

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
