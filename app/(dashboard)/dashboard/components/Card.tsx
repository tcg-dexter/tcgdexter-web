export function Card({
  children,
  variant = "default",
  className,
}: {
  children: React.ReactNode;
  variant?: "default" | "elevated" | "hero";
  className?: string;
}) {
  // Three card looks share the same rounded shell so they stack consistently:
  //   default  — flat white, used for body content
  //   elevated — extra shadow + subtle gradient, for the most important blocks
  //   hero     — gradient + accent ring, for the page hero
  const base = "rounded-2xl border border-black/8 p-4 sm:p-5";
  const styles =
    variant === "hero"
      ? "bg-gradient-to-br from-white via-white to-[color:rgba(217,85,85,0.06)] shadow-[0_1px_2px_rgba(15,15,15,0.04),0_8px_24px_-12px_rgba(217,85,85,0.25)]"
      : variant === "elevated"
        ? "bg-gradient-to-b from-white to-[var(--surface)]/40 shadow-[0_1px_2px_rgba(15,15,15,0.04),0_4px_18px_-12px_rgba(15,15,15,0.18)]"
        : "bg-white shadow-sm";
  return <div className={`${base} ${styles} ${className ?? ""}`.trim()}>{children}</div>;
}

export function Stat({
  label,
  value,
  hint,
  delta,
  size = "md",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  delta?: { value: number; suffix?: string };
  size?: "md" | "lg";
}) {
  const valueClass =
    size === "lg"
      ? "mt-1 text-3xl font-semibold tabular-nums tracking-tight text-[var(--text-primary)] sm:text-4xl"
      : "mt-0.5 text-2xl font-semibold tabular-nums tracking-tight text-[var(--text-primary)]";
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
        {label}
      </div>
      <div className={valueClass}>{value}</div>
      {delta || hint ? (
        <div className="mt-1 flex items-baseline gap-1.5 text-[11px] text-[var(--text-secondary)]">
          {delta ? <Delta {...delta} /> : null}
          {hint ? <span className="text-[var(--text-muted)]">{hint}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export function Delta({ value, suffix }: { value: number; suffix?: string }) {
  if (value === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">
        <span aria-hidden>–</span>
        {Math.abs(value)}
        {suffix ?? ""}
      </span>
    );
  }
  const up = value > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
        up ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
      }`}
    >
      <span aria-hidden>{up ? "▲" : "▼"}</span>
      {Math.abs(value)}
      {suffix ?? ""}
    </span>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  meta,
}: {
  eyebrow: string;
  title?: React.ReactNode;
  meta?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          {eyebrow}
        </div>
        {title ? (
          <h2 className="mt-0.5 text-base font-semibold tracking-tight text-[var(--text-primary)] sm:text-lg">
            {title}
          </h2>
        ) : null}
      </div>
      {meta ? (
        <div className="text-[11px] text-[var(--text-muted)]">{meta}</div>
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
  fill = true,
  className,
  responsive = false,
}: {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  /**
   * Render a subtle gradient under the polyline so the spark reads as a
   * filled area chart at small sizes. Defaults on — sparklines feel flat
   * and clinical without it.
   */
  fill?: boolean;
  className?: string;
  responsive?: boolean;
}) {
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const coords = values.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * height;
    return [x, y] as const;
  });
  const points = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const lastX = coords[coords.length - 1]?.[0] ?? 0;
  const areaPath = `M0,${height} L${points.split(" ").join(" L")} L${lastX.toFixed(1)},${height} Z`;
  const sizeProps = responsive
    ? ({ preserveAspectRatio: "none" } as const)
    : { width, height };
  const klass = responsive
    ? `block w-full h-auto ${className ?? ""}`
    : `block ${className ?? ""}`;
  const gradId = `spark-grad-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <svg {...sizeProps} viewBox={`0 0 ${width} ${height}`} className={klass.trim()}>
      {fill ? (
        <>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradId})`} />
        </>
      ) : null}
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

export function Initials({ from }: { from: string }) {
  // Pick 1–2 letters from the first non-empty token of `from`. Used to give
  // ActivityFeed rows a quick face-value identifier without an avatar lookup.
  const tokens = from
    .replace(/[<>@]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const letters =
    tokens.length >= 2
      ? (tokens[0][0] + tokens[1][0]).toUpperCase()
      : (tokens[0]?.slice(0, 2) ?? "?").toUpperCase();
  // Stable color from the input so the same user always gets the same swatch.
  let hash = 0;
  for (let i = 0; i < from.length; i++) hash = (hash * 31 + from.charCodeAt(i)) >>> 0;
  const palette = [
    "bg-rose-100 text-rose-700",
    "bg-amber-100 text-amber-700",
    "bg-emerald-100 text-emerald-700",
    "bg-sky-100 text-sky-700",
    "bg-violet-100 text-violet-700",
    "bg-fuchsia-100 text-fuchsia-700",
  ];
  const tone = palette[hash % palette.length];
  return (
    <span
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${tone}`}
      aria-hidden
    >
      {letters}
    </span>
  );
}
