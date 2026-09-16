"use client";

import { useState } from "react";

import type { Severity } from "@/lib/ml/strategist/coachGame";
import { SeverityChip, decisionChip } from "./chips";

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
}

export interface DecisionTimelineProps {
  decisions: readonly TimelineDecision[];
}

const ord = (x: number) => x.toFixed(3);

export default function DecisionTimeline({ decisions }: DecisionTimelineProps) {
  const [open, setOpen] = useState<number | null>(null);

  if (decisions.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-black/15 bg-surface p-6 text-center text-sm text-text-muted dark:border-white/15 dark:bg-surface-2">
        No decisions in this log could be valued.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {decisions.map((d) => {
        const kind = decisionChip(d);
        const expanded = open === d.actionIndex;
        return (
          <li
            key={d.actionIndex}
            className={`overflow-hidden rounded-lg border bg-white dark:bg-surface-elevated ${
              kind
                ? "border-black/8 dark:border-white/10"
                : "border-black/4 dark:border-white/5"
            }`}
          >
            <button
              type="button"
              onClick={() => setOpen(expanded ? null : d.actionIndex)}
              aria-expanded={expanded}
              className="flex w-full items-start gap-2.5 p-3 text-left"
            >
              <span
                className={`mt-px shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                  kind
                    ? "bg-surface text-text-secondary dark:bg-surface-2"
                    : "bg-surface/60 text-text-muted dark:bg-surface-2/60"
                }`}
              >
                {d.turn === null ? "—" : `T${d.turn}`}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {/* Muted when the play carries no judgement — the row is
                      there for context, not as a verdict. */}
                  <span
                    className={`text-xs ${
                      kind ? "font-medium text-text-primary" : "text-text-muted"
                    }`}
                  >
                    {d.played}
                  </span>
                  {kind && <SeverityChip kind={kind} />}
                </span>

                {kind === "brilliant" && d.bestAlternative && (
                  <span className="mt-1 block text-[11px] leading-relaxed text-text-secondary">
                    rather than: {d.bestAlternative}
                  </span>
                )}
                {kind && kind !== "brilliant" && d.bestAlternative && (
                  <span className="mt-1 block text-[11px] leading-relaxed text-text-secondary">
                    better: {d.bestAlternative}
                  </span>
                )}
              </span>
            </button>

            {expanded && (
              <div className="border-t border-black/5 px-3 py-2.5 dark:border-white/5">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] sm:grid-cols-4">
                  <Detail label="alternatives" value={String(d.legalCount)} />
                  <Detail label="stakes" value={ord(d.stakes)} />
                  <Detail label="error bar" value={`±${ord(1.96 * d.regretSe)}`} />
                  <Detail
                    label="captured"
                    value={d.capture === null ? "—" : `${Math.round(d.capture * 100)}%`}
                  />
                </dl>
                <p className="mt-2 text-[10px] leading-relaxed text-text-muted">
                  {d.playedKind} · stakes and the error bar are in the search&rsquo;s own
                  ordinal units, not win probability.
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
