export interface CompositionCounts {
  pokemon: number;
  trainer: number;
  energy: number;
}

interface Props {
  counts: CompositionCounts;
  /** Pixel size of the ring (viewBox scales to match). Default matches the
   *  deck-card use case. */
  size?: number;
  className?: string;
}

const R = 24;
const STROKE = 7;
const CIRCUMFERENCE = 2 * Math.PI * R;
const GAP = 10;

/**
 * Three-arc rounded-cap donut showing a deck's Pokémon/Trainer/Energy
 * composition. Pokémon renders solid ink, Trainer uses the site's brand
 * gradient (via BrandGradientDefs, mounted once by the caller's page),
 * Energy renders as a bordered, unfilled arc — a thin border in light
 * mode (--ring-energy-fill matches the light card background so the
 * interior reads as empty) and a plain white border with no fill in
 * dark mode (--ring-energy-fill is transparent there).
 */
export default function CompositionRing({ counts, size = 58, className }: Props) {
  const { pokemon, trainer, energy } = counts;
  const total = pokemon + trainer + energy;
  if (total <= 0) {
    return (
      <svg width={size} height={size} viewBox="0 0 58 58" className={className}>
        <circle cx="29" cy="29" r={R} stroke="var(--surface-2)" strokeWidth={STROKE} fill="none" />
      </svg>
    );
  }

  const available = CIRCUMFERENCE - GAP * 3;
  let cumulative = 0;
  const arcs = [pokemon, trainer, energy].map((value) => {
    const length = (available * value) / total;
    const arc = { length, offset: -cumulative };
    cumulative += length + GAP;
    return arc;
  });

  const dashProps = (arc: { length: number; offset: number }) => ({
    strokeDasharray: `${arc.length.toFixed(1)} ${(CIRCUMFERENCE - arc.length).toFixed(1)}`,
    strokeDashoffset: arc.offset.toFixed(1),
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 58 58"
      className={className}
      style={{ transform: "rotate(-90deg)", transformOrigin: "50% 50%" }}
    >
      <circle
        cx="29"
        cy="29"
        r={R}
        stroke="var(--text-primary)"
        strokeWidth={STROKE}
        fill="none"
        strokeLinecap="round"
        {...dashProps(arcs[0])}
      />
      <circle
        cx="29"
        cy="29"
        r={R}
        stroke="url(#brandGradient)"
        strokeWidth={STROKE}
        fill="none"
        strokeLinecap="round"
        {...dashProps(arcs[1])}
      />
      <circle
        cx="29"
        cy="29"
        r={R}
        stroke="var(--text-primary)"
        strokeWidth={STROKE + 2}
        fill="none"
        strokeLinecap="round"
        {...dashProps(arcs[2])}
      />
      <circle
        cx="29"
        cy="29"
        r={R}
        stroke="var(--ring-energy-fill)"
        strokeWidth={STROKE - 0.8}
        fill="none"
        strokeLinecap="round"
        {...dashProps(arcs[2])}
      />
    </svg>
  );
}

export function CompositionLegend({ counts }: { counts: CompositionCounts }) {
  const rows: { label: string; n: number; swatch: React.CSSProperties }[] = [
    { label: "Pokémon", n: counts.pokemon, swatch: { background: "var(--text-primary)" } },
    { label: "Trainer", n: counts.trainer, swatch: { background: "var(--gradient-brand)" } },
    {
      label: "Energy",
      n: counts.energy,
      swatch: { background: "var(--ring-energy-fill)", border: "1px solid var(--text-primary)", boxSizing: "border-box" },
    },
  ];
  return (
    <div className="flex flex-col gap-[5px]">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-[7px] text-[12.5px] font-semibold text-text-secondary">
          <span className="w-2 h-2 rounded-[2px] shrink-0" style={row.swatch} />
          {row.n} {row.label}
        </div>
      ))}
    </div>
  );
}
