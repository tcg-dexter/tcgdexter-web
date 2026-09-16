import type { Severity } from "@/lib/ml/strategist/coachGame";
import { CountPill, decisionChip } from "./chips";

/** The minimum a summary needs. Typed structurally rather than as a
 *  `CoachedGame` so the same component renders the API's serialized payload
 *  today and a server-computed game later, without an adapter. */
export interface GameSummaryProps {
  game: {
    coverage: number;
    meanCapture: number | null;
    decisions: readonly { severity: Severity; skilled: boolean; significant: boolean }[];
    stats: { decisions: number; matched: number };
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export default function GameSummary({ game }: GameSummaryProps) {
  const { stats, decisions } = game;

  const counts = { inaccuracy: 0, mistake: 0, blunder: 0, brilliant: 0 };
  for (const d of decisions) {
    const kind = decisionChip(d);
    if (kind) counts[kind] += 1;
  }

  // What the timeline actually contains can be smaller than what the engine
  // matched: a matched decision still drops out if the search could not put a
  // number on it. Stating only the larger figure would overclaim.
  const graded = decisions.length;
  const unstated = stats.matched - graded;

  return (
    <div className="rounded-2xl border border-black/8 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-surface-elevated">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-3">
        <div>
          <div className="text-2xl font-bold tabular-nums text-text-primary">
            {game.meanCapture === null ? "—" : pct(game.meanCapture)}
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            value captured
          </div>
        </div>
        <div>
          <div className="text-2xl font-bold tabular-nums text-text-primary">
            {pct(game.coverage)}
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            coverage
          </div>
        </div>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-text-secondary">
        {game.meanCapture === null
          ? "No decision in this game had enough at stake to score — there was no value on the table to take or miss."
          : `Of the value available at the decisions we could read, you took ${pct(game.meanCapture)}.`}
      </p>

      <p className="mt-2 text-xs leading-relaxed text-text-secondary">
        Evaluated {stats.matched} of {stats.decisions}{" "}
        {stats.decisions === 1 ? "decision" : "decisions"} ({pct(game.coverage)}). The rest
        are plays the engine cannot yet reconstruct — not necessarily good or bad.
        {unstated > 0
          ? ` ${graded} of the ${stats.matched} produced a usable value estimate, and those are the ones below.`
          : ""}
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <CountPill label="brilliant" value={counts.brilliant} />
        <CountPill label="inaccuracies" value={counts.inaccuracy} />
        <CountPill label="mistakes" value={counts.mistake} />
        <CountPill label="blunders" value={counts.blunder} />
      </div>
    </div>
  );
}
