import { Sparkline } from "./Card";
import type { FeatureRow } from "../lib/analytics";

const EVENT_LABELS: Record<string, string> = {
  "analyze.completed": "Analyzed a deck",
  "deck.saved": "Saved a deck",
  "deck.shared": "Shared a deck",
  "deck.renamed": "Renamed a deck",
  "deck.edited": "Edited a deck",
  "deck.deleted": "Deleted a deck",
  "deck.published": "Published a deck",
  "deck.unpublished": "Unpublished a deck",
  "deck.updated": "Updated a deck",
  "match.logged": "Logged a match",
  "auth.signed_in": "Signed in",
  "auth.signed_up": "Signed up",
};

export default function EventAdoptionList({ rows }: { rows: FeatureRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-[var(--border)]/30 bg-[var(--surface)] p-4 text-xs text-[var(--text-muted)]">
        No active users in this window yet.
      </div>
    );
  }
  return (
    <div className="flex flex-col divide-y divide-[var(--border)]/20 rounded-md border border-[var(--border)]/30 bg-white">
      {rows.map((r) => {
        const label = EVENT_LABELS[r.eventName] ?? r.eventName;
        return (
          <div
            key={r.eventName}
            className="flex items-center gap-4 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                {label}
              </div>
              <div className="text-[11px] text-[var(--text-muted)] font-mono">
                {r.eventName}
              </div>
            </div>
            <div className="hidden sm:block">
              <Sparkline values={r.weekly} width={120} height={28} />
            </div>
            <div className="w-24 text-right tabular-nums">
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                {r.userCount.toLocaleString()}
              </div>
              <div className="text-[11px] text-[var(--text-muted)]">
                {r.pctOfActive.toFixed(1)}% of active
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
