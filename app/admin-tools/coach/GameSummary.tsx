import type { Severity } from "@/lib/ml/strategist/coachGame";
import {
  CHIP_LABELS,
  CHIP_LABELS_PLURAL,
  CountPill,
  decisionChip,
  type ChipKind,
} from "./chips";

/** The minimum a summary needs. Typed structurally rather than as a
 *  `CoachedGame` so the same component renders the API's serialized payload
 *  today and a server-computed game later, without an adapter. */
export interface GameSummaryProps {
  game: {
    // `coverage` is deliberately not read here. How much of the log the
    // engine could reconstruct is not the player's business and is not
    // surfaced; the caller may still carry it.
    meanCapture: number | null;
    decisions: readonly {
      severity: Severity;
      skilled: boolean;
      significant: boolean;
    }[];
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export default function GameSummary({ game }: GameSummaryProps) {
  const counts: Record<ChipKind, number> = {
    brilliant: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
  };
  for (const d of game.decisions) {
    const kind = decisionChip(d);
    if (kind) counts[kind] += 1;
  }
  // Order the tallies the way the timeline reads: praise first, then by weight.
  const order: ChipKind[] = ["brilliant", "inaccuracy", "mistake", "blunder"];
  const shown = order.filter((k) => counts[k] > 0);

  return (
    <div className="rounded-2xl border border-black/8 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-surface-elevated">
      <div className="text-2xl font-bold tabular-nums text-text-primary">
        {game.meanCapture === null ? "\u2014" : pct(game.meanCapture)}
      </div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        value captured
      </div>

      {/* Deliberately says nothing about how much of the log was read.
          The denominator has narrowed twice and is narrower than it looks:
          `meanCapture` averages `capture` over decisions that are NOT
          `materialized` and have stakes above 0.05. Recovered decisions are
          excluded because they carry no skill signal (+0.6 pts, z=0.22) — the
          reconstructed hand is a floor, so the alternatives capture divides by
          are incomplete.
          So the engine spec's suggested line, "the value available at the
          decisions we could read", is false on its own terms: recovered
          decisions WERE read and are not counted. This wording claims no
          completeness, which keeps it both opaque and true. */}
      <p className="mt-3 text-xs leading-relaxed text-text-secondary">
        {game.meanCapture === null
          ? "Nothing in this game had enough at stake to score \u2014 there was no value on the table to take or miss."
          : `Across the decisions that had something at stake, you took ${pct(game.meanCapture)} of the value available.`}
      </p>

      {shown.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {shown.map((k) => (
            <CountPill
              key={k}
              label={
                counts[k] === 1
                  ? CHIP_LABELS[k].toLowerCase()
                  : CHIP_LABELS_PLURAL[k]
              }
              value={counts[k]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
