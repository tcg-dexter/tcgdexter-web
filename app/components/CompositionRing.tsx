import { shade } from "@/lib/color";

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
  /** Deck's hero-Pokémon accent color (UserDeckCardProps.iconBg) — the
   *  Pokémon arc's gradient. Falls back to the same neutral DeckBanner
   *  uses when no primary Pokémon resolved a type. */
  heroColor?: string | null;
}

const R = 24;
const STROKE = 7;
const CIRCUMFERENCE = 2 * Math.PI * R;
const GAP = 10;

/**
 * Three-arc rounded-cap donut showing a deck's Pokémon/Trainer/Energy
 * composition. Pokémon renders a gradient keyed to the deck's hero
 * Pokémon energy type (heroColor — the same accent the card's avatar
 * circle uses), Trainer renders solid ink, Energy renders as a bordered,
 * unfilled arc — matching the swatch CompositionLegend draws for it
 * (border in --text-primary, no fill).
 *
 * The Energy arc's hollow interior is a real hole punched with an SVG
 * <mask>, not a fill painted in the card's background color. The earlier
 * approach stacked a --ring-energy-fill stroke over the band, which only
 * worked in light mode: that token is `transparent` in dark mode, and a
 * transparent stroke paints nothing rather than erasing what's under it,
 * so the whole band survived and the arc read as a solid white bar. A
 * mask is theme- and background-independent — the arc is genuinely
 * see-through wherever the ring is placed.
 */
export default function CompositionRing({ counts, size = 58, className, heroColor }: Props) {
  const { pokemon, trainer, energy } = counts;
  const total = pokemon + trainer + energy;
  const accentBg = heroColor ?? "#B0A89E";
  const accentDeep = shade(accentBg, -35);
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

  /**
   * The mask has to carry the Energy arc's own dash geometry (a full-circle
   * hole would cut straight through the arc's rounded end caps and leave the
   * outline open at both ends), so it can't be one document-wide definition —
   * several deck cards render rings on the same page. The id is derived from
   * that geometry instead of from useId(): a decks grid renders this from a
   * client component today but the component itself is server-safe, and
   * useId's output contains colons, which have to be escaped before they can
   * go in a url(#…) reference. Same geometry ⇒ same id ⇒ byte-identical mask
   * content, so a shared id is always safe here.
   */
  const energyMaskId = `dx-energy-cutout-${arcs[2].length.toFixed(1)}-${arcs[2].offset.toFixed(1)}`.replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  );
  // Same reasoning as energyMaskId above: id derived from the gradient's own
  // content (not useId()) so multiple rings on one page can safely share an
  // id when their hero color happens to match.
  const heroGradientId = `dx-hero-gradient-${accentBg}`.replace(/[^a-zA-Z0-9_-]/g, "_");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 58 58"
      className={className}
      style={{ transform: "rotate(-90deg)", transformOrigin: "50% 50%" }}
    >
      <defs>
        <linearGradient id={heroGradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={accentDeep} />
          <stop offset="100%" stopColor={accentBg} />
        </linearGradient>
        {/* White keeps, black cuts: the wide band minus the narrower inner
            stroke leaves a 1.4-unit rim, closed around the round caps
            because both strokes share the caps and dash array. Explicit
            userSpaceOnUse bounds — the default mask region is a percentage
            of the object bounding box, which for a stroked circle excludes
            the stroke and would clip the band's outer edge. */}
        <mask id={energyMaskId} maskUnits="userSpaceOnUse" x="0" y="0" width="58" height="58">
          <circle
            cx="29"
            cy="29"
            r={R}
            stroke="#fff"
            strokeWidth={STROKE + 2}
            fill="none"
            strokeLinecap="round"
            {...dashProps(arcs[2])}
          />
          <circle
            cx="29"
            cy="29"
            r={R}
            stroke="#000"
            strokeWidth={STROKE - 0.8}
            fill="none"
            strokeLinecap="round"
            {...dashProps(arcs[2])}
          />
        </mask>
      </defs>

      <circle
        cx="29"
        cy="29"
        r={R}
        stroke={`url(#${heroGradientId})`}
        strokeWidth={STROKE}
        fill="none"
        strokeLinecap="round"
        {...dashProps(arcs[0])}
      />
      <circle
        cx="29"
        cy="29"
        r={R}
        stroke="var(--text-primary)"
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
        mask={`url(#${energyMaskId})`}
        {...dashProps(arcs[2])}
      />
    </svg>
  );
}

export function CompositionLegend({
  counts,
  heroColor,
}: {
  counts: CompositionCounts;
  /** Same hero-Pokémon accent as CompositionRing's Pokémon arc. */
  heroColor?: string | null;
}) {
  const accentBg = heroColor ?? "#B0A89E";
  const accentDeep = shade(accentBg, -35);
  const rows: { label: string; n: number; swatch: React.CSSProperties }[] = [
    { label: "Pokémon", n: counts.pokemon, swatch: { background: `linear-gradient(135deg, ${accentDeep} 0%, ${accentBg} 100%)` } },
    { label: "Trainer", n: counts.trainer, swatch: { background: "var(--text-primary)" } },
    {
      label: "Energy",
      n: counts.energy,
      // The swatch is small enough that a real cut-out buys nothing: an
      // opaque light-mode fill and a transparent dark-mode one both read as
      // "empty" against the cards these sit on. --ring-energy-fill stays for
      // this one use.
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
