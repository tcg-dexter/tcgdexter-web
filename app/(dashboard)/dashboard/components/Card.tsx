export function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-black/8 bg-white p-5 shadow-sm">
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
}: {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
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
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block"
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
