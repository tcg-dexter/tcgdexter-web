export function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-black/8 bg-white p-4 shadow-sm sm:p-5">
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums text-[var(--text-primary)]">
        {value}
      </div>
      {hint ? (
        <div className="text-[11px] text-[var(--text-secondary)]">{hint}</div>
      ) : null}
    </div>
  );
}

export function ErrorBox({ error }: { error: string }) {
  return (
    <Card>
      <div className="text-sm text-[var(--accent)]">
        Failed to load: <span className="font-mono text-xs">{error}</span>
      </div>
    </Card>
  );
}

export function Sparkline({
  values,
  width = 220,
  height = 36,
  stroke = "#d95555",
  className,
  responsive = false,
}: {
  values: number[];
  /** Used as the SVG viewBox width — the intrinsic aspect target. */
  width?: number;
  height?: number;
  stroke?: string;
  /** Extra Tailwind classes (use w-full to stretch to the container). */
  className?: string;
  /**
   * When true, the SVG drops its explicit width/height and stretches to fill
   * its parent (default class becomes `w-full h-auto`). Use for sparklines
   * inside flexible cards that need to scale down on mobile.
   */
  responsive?: boolean;
}) {
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const sizeProps = responsive
    ? ({ preserveAspectRatio: "none" } as const)
    : { width, height };
  const klass = responsive
    ? `block w-full h-auto ${className ?? ""}`
    : `block ${className ?? ""}`;
  return (
    <svg
      {...sizeProps}
      viewBox={`0 0 ${width} ${height}`}
      className={klass.trim()}
    >
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
    </svg>
  );
}

export function relTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}
