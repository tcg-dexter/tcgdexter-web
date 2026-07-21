// Per-turn win-probability sparkline — shared by the admin coach panel and
// the user-facing battle analysis. Generic over any {turn_number, actor,
// p_win} curve, so it renders the human-log winprob model and the
// board-aware value model identically.

export interface SparkPoint {
  turn_number: number;
  actor: "player" | "opponent";
  p_win: number;
}

export default function WinProbSparkline({
  curve,
  dimmed = false,
}: {
  curve: SparkPoint[];
  /** Render desaturated (low-confidence curves that shouldn't read as fact). */
  dimmed?: boolean;
}) {
  if (curve.length === 0) return null;
  const width = 560;
  const height = 120;
  const padX = 8;
  const padY = 10;
  const stepX = curve.length > 1 ? (width - padX * 2) / (curve.length - 1) : 0;
  const yFor = (p: number) => padY + (1 - p) * (height - padY * 2);
  const points = curve.map((pt, i) => `${padX + i * stepX},${yFor(pt.p_win).toFixed(1)}`);
  const last = curve[curve.length - 1];
  const lineColor = dimmed ? "#c9a0a0" : "#d95555";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label="Win probability by turn"
    >
      {/* 50% reference line */}
      <line
        x1={padX}
        x2={width - padX}
        y1={yFor(0.5)}
        y2={yFor(0.5)}
        stroke="#d0d0d0"
        strokeDasharray="4 4"
        strokeWidth="1"
      />
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={lineColor}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {curve.map((pt, i) => (
        <circle
          key={pt.turn_number}
          cx={padX + i * stepX}
          cy={yFor(pt.p_win)}
          r="2.5"
          fill={pt.actor === "player" ? lineColor : "#888888"}
        >
          <title>{`Turn ${pt.turn_number} (${pt.actor}): ${(pt.p_win * 100).toFixed(0)}%`}</title>
        </circle>
      ))}
      <text x={width - padX} y={yFor(last.p_win) - 6} textAnchor="end" fontSize="11" fill="#4a4a4a">
        {(last.p_win * 100).toFixed(0)}%
      </text>
    </svg>
  );
}
