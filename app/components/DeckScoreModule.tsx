import type { AxisResult, DeckGrade } from "@/lib/deckGrade/types";

/**
 * Deck Grade — the headline deck-health readout.
 *
 * Preferred path: the v2 `DeckGrade` (function-based, style-aware) renders a
 * hero letter grade + the detected play-style + a per-axis findings list. Each
 * finding is the free *diagnosis*; the paid-coaching *remedy* (`axis.lever`) is
 * intentionally not shown yet.
 *
 * Fallback path: rows persisted before v2 only carry the legacy 4-subscore
 * `deckScore` — those render the simpler grade + bars view so nothing regresses.
 * When neither is present (older analyses without a score at all), renders null.
 */
interface LegacyScore {
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

const STATUS_COLOR: Record<AxisResult["status"], string> = {
  good: "#2f9e44",
  warn: "#d98a00",
  weak: "#d93232",
  info: "#888888",
};

const CARD_CLS =
  "rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm p-5";

function GradeBadge({ grade, total }: { grade: string; total: number }) {
  const style = GRADE_STYLE[grade] ?? GRADE_STYLE.C;
  return (
    <div className="flex items-center gap-4">
      <div
        className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl text-4xl font-black leading-none"
        style={{ color: style.fg, background: style.bg }}
      >
        {grade}
      </div>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-text-primary">Deck Grade</h2>
        <p className="text-sm text-text-secondary">
          <span className="font-semibold tabular-nums" style={{ color: style.fg }}>
            {total}
          </span>
          <span className="text-text-muted">/100 overall</span>
        </p>
      </div>
    </div>
  );
}

function AxisRow({ axis }: { axis: AxisResult }) {
  const color = STATUS_COLOR[axis.status];
  const isInfo = axis.status === "info";
  return (
    <div className="flex items-start gap-3 border-t border-black/5 py-2.5 first:border-t-0 first:pt-0">
      <span
        className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full"
        style={{ background: color }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-text-primary">{axis.label}</span>
          {!isInfo && (
            <span className="text-xs font-semibold tabular-nums" style={{ color }}>
              {axis.score}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-text-secondary">{axis.finding}</p>
      </div>
    </div>
  );
}

function renderGrade(grade: DeckGrade) {
  return (
    <div className={CARD_CLS}>
      <div className="flex items-start justify-between gap-3">
        <GradeBadge grade={grade.grade} total={grade.total} />
        <span className="mt-1 rounded-full bg-black/5 px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-text-secondary">
          {grade.styleLabel}
        </span>
      </div>

      <div className="mt-4">
        {grade.axes.map((axis) => (
          <AxisRow key={axis.key} axis={axis} />
        ))}
      </div>

      {/* Coaching teaser — findings above are the free diagnosis; the fix
          (each axis's lever) is the paid coaching layer, not yet shipped. */}
      <p className="mt-4 text-xs text-text-muted">
        Coaching — how to fix each of these — coming soon.
      </p>
    </div>
  );
}

function renderLegacy(score: LegacyScore) {
  const style = GRADE_STYLE[score.grade] ?? GRADE_STYLE.C;
  const bars = [
    { label: "Rotation", value: score.rotation },
    { label: "Consistency", value: score.consistency },
    { label: "Evolution", value: score.evolution },
    { label: "Energy Fit", value: score.energyFit },
  ];
  return (
    <div className={CARD_CLS}>
      <GradeBadge grade={score.grade} total={score.total} />
      <div className="mt-4 space-y-2.5">
        {bars.map((b) => {
          const pct = Math.max(0, Math.min(100, (b.value / 25) * 100));
          return (
            <div key={b.label}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-text-secondary">{b.label}</span>
                <span className="font-semibold tabular-nums text-text-primary">
                  {b.value}
                  <span className="font-normal text-text-muted">/25</span>
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
    </div>
  );
}

export default function DeckScoreModule({
  grade,
  legacyScore,
}: {
  grade?: DeckGrade | null;
  legacyScore?: LegacyScore | null;
}) {
  if (grade) return renderGrade(grade);
  if (legacyScore) return renderLegacy(legacyScore);
  return null;
}
