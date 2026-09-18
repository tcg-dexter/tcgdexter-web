"use client";

import { useState } from "react";

import type { Severity } from "@/lib/ml/strategist/coachGame";
import { SeverityChip, decisionChip, type ChipKind } from "./chips";

/** Structural, for the same reason as GameSummaryProps. */
export interface TimelineDecision {
  turn: number | null;
  actionIndex: number;
  played: string;
  playedKind: string;
  bestAlternative: string | null;
  regretSe: number;
  severity: Severity;
  significant: boolean;
  capture: number | null;
  stakes: number;
  skilled: boolean;
  legalCount: number;
  /** The oracle proved the advice cannot change the result. Such a row is
   *  dropped entirely by the filter below — see decisionChip. */
  moot: boolean | null;
}

export interface DecisionTimelineProps {
  decisions: readonly TimelineDecision[];
}

const ord = (x: number) => x.toFixed(3);

export default function DecisionTimeline({ decisions }: DecisionTimelineProps) {
  const [open, setOpen] = useState<number | null>(null);

  // Only decisions the coach actually has something to say about. An unjudged
  // play is omitted entirely rather than greyed out: the coach speaks where it
  // has a point to make and stays quiet — and opaque — everywhere else. Turn
  // numbers will therefore skip, which is the intended reading.
  const judged = decisions
    .map((d) => ({ d, kind: decisionChip(d) }))
    .filter(
      (x): x is { d: TimelineDecision; kind: ChipKind } => x.kind !== null,
    );

  if (judged.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-black/15 bg-surface p-6 text-center text-sm text-text-muted dark:border-white/15 dark:bg-surface-2">
        Nothing to flag in this game — no play cost enough to be worth calling
        out.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {judged.map(({ d, kind }) => {
        const expanded = open === d.actionIndex;
        return (
          <li
            key={d.actionIndex}
            className="overflow-hidden rounded-lg border border-black/8 bg-white dark:border-white/10 dark:bg-surface-elevated"
          >
            <button
              type="button"
              onClick={() => setOpen(expanded ? null : d.actionIndex)}
              aria-expanded={expanded}
              className="flex w-full items-start gap-2.5 p-3 text-left"
            >
              <span className="mt-px shrink-0 rounded bg-surface px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-text-secondary dark:bg-surface-2">
                {d.turn === null ? "\u2014" : `T${d.turn}`}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-xs font-medium text-text-primary">
                    {d.played}
                  </span>
                  <SeverityChip kind={kind} />
                </span>

                {d.bestAlternative && (
                  <span className="mt-1 block text-[11px] leading-relaxed text-text-secondary">
                    {kind === "brilliant" ? "rather than: " : "better: "}
                    {d.bestAlternative}
                  </span>
                )}
              </span>
            </button>

            {expanded && (
              <div className="border-t border-black/5 px-3 py-2.5 dark:border-white/5">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] sm:grid-cols-4">
                  <Detail label="alternatives" value={String(d.legalCount)} />
                  <Detail label="stakes" value={ord(d.stakes)} />
                  <Detail
                    label="error bar"
                    value={`\u00b1${ord(1.96 * d.regretSe)}`}
                  />
                  <Detail
                    label="captured"
                    value={
                      d.capture === null
                        ? "\u2014"
                        : `${Math.round(d.capture * 100)}%`
                    }
                  />
                </dl>
                <p className="mt-2 text-[10px] leading-relaxed text-text-muted">
                  {d.playedKind} · stakes and the error bar are in the
                  search&rsquo;s own ordinal units, not win probability.
                </p>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-text-muted">{label}</dt>
      <dd className="font-semibold tabular-nums text-text-primary">{value}</dd>
    </div>
  );
}
