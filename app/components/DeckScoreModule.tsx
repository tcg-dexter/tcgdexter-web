/**
 * Deck Grade — the headline deck-health readout. Renders the analyzer's
 * `deckScore` (letter grade S–D + total /100) as a hero badge, with the four
 * sub-scores (rotation / consistency / evolution / energy fit, each /25) as
 * labeled bars.
 *
 * This is a free-tier *diagnosis* surface: it shows where a deck loses points
 * but not how to fix them — the prescriptive "how to raise each score" layer
 * is reserved for the (upcoming) paid coaching system.
 *
 * `deckScore` is optional on older persisted analyses (repriceDeck only
 * refreshes price + rotation, not scores), so this renders nothing when the
 * score is absent rather than fabricating one.
 */
interface DeckScore {
  total: number;
  grade: string;
  rotation: number;
  consistency: number;
  evolution: number;
  energyFit: number;
}

const GRADE_STYLE: Record<string, { fg: string; bg: string }> = {
  S: { fg: "#7c3aed", bg: "rgba(124,58,237,0.12)" },
  A: { fg: "#2f9e44", bg: "rgba(47,158,68,0.12)" },
  B: { fg: "#0096d3", bg: "rgba(0,150,211,0.12)" },
  C: { fg: "#d98a00", bg: "rgba(217,138,0,0.12)" },
  D: { fg: "#d93232", bg: "rgba(217,50,50,0.12)" },
};

const SUBSCORE_MAX = 25;

export default function DeckScoreModule({ score }: { score?: DeckScore | null }) {
  if (!score) return null;
  const style = GRADE_STYLE[score.grade] ?? GRADE_STYLE.C;

  const bars = [
    { label: "Rotation", value: score.rotation },
    { label: "Consistency", value: score.consistency },
    { label: "Evolution", value: score.evolution },
    { label: "Energy Fit", value: score.energyFit },
  ];

  return (
    <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm p-5">
      <div className="flex items-center gap-4">
        <div
          className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl text-4xl font-black leading-none"
          style={{ color: style.fg, background: style.bg }}
        >
          {score.grade}
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-text-primary">Deck Grade</h2>
          <p className="text-sm text-text-secondary">
            <span
              className="font-semibold tabular-nums"
              style={{ color: style.fg }}
            >
              {score.total}
            </span>
            <span className="text-text-muted">/100 overall</span>
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-2.5">
        {bars.map((b) => {
          const pct = Math.max(0, Math.min(100, (b.value / SUBSCORE_MAX) * 100));
          return (
            <div key={b.label}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-text-secondary">{b.label}</span>
                <span className="font-semibold tabular-nums text-text-primary">
                  {b.value}
                  <span className="font-normal text-text-muted">/{SUBSCORE_MAX}</span>
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-black/5">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, background: style.fg }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Coaching teaser — the free grade is the diagnosis; the remedy (how to
          raise each score) is the paid coaching layer, not yet shipped. */}
      <p className="mt-4 text-xs text-text-muted">
        Coaching breakdowns — how to raise each score — coming soon.
      </p>
    </div>
  );
}
