import type { ActivationData, BehaviorData } from "../lib/analytics";

const STEP_LABELS: Record<string, string> = {
  signup: "Signed up",
  "analyze.completed": "Analyzed a deck",
  "deck.saved": "Saved a deck",
  "match.logged": "Logged a match",
};

type Tone = "positive" | "negative" | "neutral";

type Insight = {
  tone: Tone;
  headline: string;
  detail: string;
};

// Thresholds tuned for low-volume data: at our current scale we want
// callouts that fire even on modest swings, but only when there's enough
// prior signal to avoid noise.
const MIN_PRIOR_FIRES = 5;

/**
 * Push synthesis to the page instead of leaving it on the reader. We rank
 * three classes of insight and surface up to three callouts in priority
 * order: (1) the worst funnel bottleneck if it's severe, (2) the biggest
 * mover up, (3) the biggest mover down. If a class has no qualifying
 * signal it falls through.
 */
function deriveInsights(
  behavior: BehaviorData,
  activation: ActivationData,
): Insight[] {
  const out: Insight[] = [];

  // 1. Funnel bottleneck — the step (after signup) with the lowest
  //    pctOfPrevious. We flag it if conversion < 50%, escalate if < 30%.
  let worstStep: (typeof activation.steps)[number] | null = null;
  for (const s of activation.steps) {
    if (s.stepOrder === 1) continue; // signup itself has no prior
    if (s.pctOfPrevious == null) continue;
    if (!worstStep || s.pctOfPrevious < worstStep.pctOfPrevious!) {
      worstStep = s;
    }
  }
  if (worstStep && worstStep.pctOfPrevious != null && worstStep.pctOfPrevious < 50) {
    const label = STEP_LABELS[worstStep.step] ?? worstStep.step;
    out.push({
      tone: worstStep.pctOfPrevious < 30 ? "negative" : "neutral",
      headline: `Funnel bottleneck at ${label}`,
      detail: `Only ${worstStep.pctOfPrevious.toFixed(0)}% of the prior step converts.`,
    });
  }

  // 2. Biggest Product mover up — Product with the highest positive
  //    deltaPct, bounded by a minimum prior fire count so a 1→3 swing on a
  //    sleepy surface doesn't dominate. Uninstrumented Products are
  //    skipped entirely.
  const movers = behavior.products.filter((p) => p.instrumented);
  const eligibleUp = movers
    .filter(
      (p) =>
        p.fireCountDeltaPct != null &&
        p.fireCountDeltaPct > 0 &&
        p.fireCountPrior >= MIN_PRIOR_FIRES,
    )
    .sort((a, b) => (b.fireCountDeltaPct ?? 0) - (a.fireCountDeltaPct ?? 0));
  const topUp = eligibleUp[0];
  if (topUp && topUp.fireCountDeltaPct != null && topUp.fireCountDeltaPct >= 20) {
    out.push({
      tone: "positive",
      headline: `${topUp.label} is up ${topUp.fireCountDeltaPct.toFixed(0)}%`,
      detail: `${topUp.fireCount} fires this window vs ${topUp.fireCountPrior} prior. Lean in.`,
    });
  }

  // 3. Biggest Product mover down — same logic, opposite sign.
  const eligibleDown = movers
    .filter(
      (p) =>
        p.fireCountDeltaPct != null &&
        p.fireCountDeltaPct < 0 &&
        p.fireCountPrior >= MIN_PRIOR_FIRES,
    )
    .sort((a, b) => (a.fireCountDeltaPct ?? 0) - (b.fireCountDeltaPct ?? 0));
  const topDown = eligibleDown[0];
  if (
    topDown &&
    topDown.fireCountDeltaPct != null &&
    topDown.fireCountDeltaPct <= -20
  ) {
    out.push({
      tone: "negative",
      headline: `${topDown.label} is down ${Math.abs(topDown.fireCountDeltaPct).toFixed(0)}%`,
      detail: `${topDown.fireCount} fires this window vs ${topDown.fireCountPrior} prior. Worth investigating.`,
    });
  }

  // 4. Coverage gap — if more than half the Products aren't instrumented
  //    yet, surface that as a neutral callout. The product team needs to
  //    know which surfaces have no signal so we don't make decisions in the
  //    dark.
  const total = behavior.products.length;
  const uninstrumented = behavior.products.filter((p) => !p.instrumented);
  if (total > 0 && uninstrumented.length / total >= 0.5) {
    const names = uninstrumented
      .slice(0, 3)
      .map((p) => p.label)
      .join(", ");
    out.push({
      tone: "neutral",
      headline: `${uninstrumented.length} of ${total} Products lack instrumentation`,
      detail: `${names}${uninstrumented.length > 3 ? "…" : ""} have no events yet — add tracking to see usage.`,
    });
  }

  return out.slice(0, 3);
}

const TONE_BAR: Record<Tone, string> = {
  positive: "bg-emerald-500",
  negative: "bg-rose-500",
  neutral: "bg-amber-500",
};

const TONE_LABEL: Record<Tone, string> = {
  positive: "text-emerald-700",
  negative: "text-rose-700",
  neutral: "text-amber-700",
};

export default function InsightsStrip({
  behavior,
  activation,
}: {
  behavior: BehaviorData;
  activation: ActivationData;
}) {
  const insights = deriveInsights(behavior, activation);
  if (insights.length === 0) {
    // Quiet success state — the page isn't broken, there's just no
    // material movement to flag. Render a placeholder so the layout
    // doesn't collapse.
    return (
      <p className="text-xs text-[var(--text-muted)]">
        No major shifts in this window. Funnel conversions and feature usage
        are tracking with the prior period.
      </p>
    );
  }
  return (
    <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {insights.map((ins, i) => (
        <div key={i} className="flex gap-3">
          <div className={`mt-1 h-full w-0.5 shrink-0 rounded-full ${TONE_BAR[ins.tone]}`} />
          <div className="min-w-0">
            <div className={`text-sm font-semibold ${TONE_LABEL[ins.tone]}`}>
              {ins.headline}
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
              {ins.detail}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
