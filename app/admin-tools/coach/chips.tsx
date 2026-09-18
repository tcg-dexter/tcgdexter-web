import type { Severity } from "@/lib/ml/strategist/coachGame";

/** What a decision row is labelled, or null for "say nothing about this one".
 *
 *  "ok" is deliberately absent: a decision whose severity is "ok" never earns
 *  a chip, so the only labels are the three bad ones and the good one.
 *
 *  Null is also what removes a row from the timeline entirely — an unjudged
 *  decision is not shown at all, rather than shown greyed out. The coach
 *  speaks only where it has something to say and is otherwise silent about
 *  what it did or did not read. */
export type ChipKind = "brilliant" | "inaccuracy" | "mistake" | "blunder";

/** THE GATE. Read this before changing how a row renders.
 *
 *  `significant` means `regret > 2 * regretSe` — the play's cost clears its
 *  own error bar. Everything below that is noise, and the instrument's
 *  credibility rests on not showing it.
 *
 *  `skilled` is NOT the same test and is not a weaker one. It requires
 *  `regret <= 2 * max(regretSe, 0.005)` — essentially the NEGATION of
 *  `significant` — plus a wide spread between best and worst, plus a paired
 *  comparison showing a competent reference policy would have played
 *  materially worse (m > 2*se). So a brilliancy is almost always
 *  `significant === false`, and checking `significant` first would hide every
 *  one of them. Hence the order below: `skilled` wins, then severity, then
 *  silence.
 *
 *  Both branches are gated on a 2-sigma test; they are just different tests. */
export function decisionChip(d: {
  skilled: boolean;
  significant: boolean;
  severity: Severity;
  moot?: boolean | null;
}): ChipKind | null {
  if (d.skilled) return "brilliant";
  // Correct, and irrelevant. The oracle proved both moves reach the same
  // result, so a chip here would be a verdict on a game that was already
  // decided — which reads as the coach not understanding the game. About a
  // fifth of what would otherwise be flagged, rising past 30% after turn 21.
  //
  // `null` is NOT `false`. Undetermined means the check could not run, and
  // must render normally rather than be read as "this mattered" — hence the
  // explicit `=== true`.
  if (d.moot === true) return null;
  if (d.significant && d.severity !== "ok") return d.severity;
  return null;
}

const CHIP_STYLES: Record<ChipKind, string> = {
  brilliant: "bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300",
  inaccuracy:
    "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  mistake:
    "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  blunder: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
};

/** Said from the COACH's side of the table, not as a verdict on the player.
 *
 *  The keys stay the engine's own vocabulary so this file and
 *  `CoachedDecision.severity` never drift, and so severity still orders the
 *  list underneath. Only the reading changes. */
export const CHIP_LABELS: Record<ChipKind, string> = {
  brilliant: "Well played",
  inaccuracy: "Suggestion",
  mistake: "Missed opportunity",
  blunder: "Learning moment",
};

/** Plural forms for the summary tallies, where the label follows a count. */
export const CHIP_LABELS_PLURAL: Record<ChipKind, string> = {
  brilliant: "well played",
  inaccuracy: "suggestions",
  mistake: "missed opportunities",
  blunder: "learning moments",
};

export function SeverityChip({ kind }: { kind: ChipKind }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${CHIP_STYLES[kind]}`}
    >
      {CHIP_LABELS[kind]}
    </span>
  );
}

/** A neutral count pill, for the summary's tallies. */
export function CountPill({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[11px] text-text-secondary dark:bg-surface-2">
      <span className="font-semibold text-text-primary">{value}</span>
      <span>{label}</span>
    </span>
  );
}
