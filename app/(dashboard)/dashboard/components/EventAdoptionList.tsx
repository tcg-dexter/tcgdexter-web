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

// Group events into surfaces. The category is derived from the event-name
// prefix and is shown as a chip so the row tells the reader which feature
// the event belongs to without having to read the dot-separated id.
type Category = "Analyze" | "Decks" | "Matches" | "Auth" | "Other";

function categoryOf(eventName: string): Category {
  const prefix = eventName.split(".")[0];
  if (prefix === "analyze") return "Analyze";
  if (prefix === "deck") return "Decks";
  if (prefix === "match") return "Matches";
  if (prefix === "auth") return "Auth";
  return "Other";
}

const CATEGORY_TONE: Record<Category, string> = {
  Analyze: "bg-violet-100 text-violet-700",
  Decks: "bg-sky-100 text-sky-700",
  Matches: "bg-amber-100 text-amber-700",
  Auth: "bg-emerald-100 text-emerald-700",
  Other: "bg-gray-100 text-gray-700",
};

function formatPerUser(fires: number, users: number): string {
  if (users === 0) return "—";
  const ratio = fires / users;
  return ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(1);
}

export default function EventAdoptionList({ rows }: { rows: FeatureRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-xs text-[var(--text-muted)]">
        No active users in this window yet.
      </p>
    );
  }

  // Sort by total event fires inside the window — the closest proxy we have
  // for "where users spend their time". Ties break by distinct user count
  // so a feature pulled by many users sits above one pulled by a power user.
  const sorted = [...rows].sort(
    (a, b) => b.fireCount - a.fireCount || b.userCount - a.userCount,
  );

  // Use the leader as the bar baseline so engagement bars read as
  // "share of the biggest feature" — useful when comparing across the column.
  const maxFires = sorted[0]?.fireCount ?? 0;

  return (
    <div className="flex flex-col divide-y divide-black/5">
      {sorted.map((r) => {
        const label = EVENT_LABELS[r.eventName] ?? r.eventName;
        const category = categoryOf(r.eventName);
        const tone = CATEGORY_TONE[category];
        const widthPct = maxFires > 0 ? (r.fireCount / maxFires) * 100 : 0;
        return (
          <div
            key={r.eventName}
            className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 py-3 sm:grid-cols-[1.4fr_2fr_auto]"
          >
            {/* Identity */}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`shrink-0 rounded-full px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wider ${tone}`}
                >
                  {category}
                </span>
                <span className="truncate text-sm font-medium tracking-tight text-[var(--text-primary)]">
                  {label}
                </span>
              </div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--text-muted)]">
                {r.eventName}
              </div>
            </div>

            {/* Engagement bar + 4-week trend */}
            <div className="col-span-2 flex items-center gap-3 sm:col-span-1">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface)]">
                <div
                  className="h-full rounded-full bg-[var(--accent)]"
                  style={{ width: `${widthPct}%` }}
                />
              </div>
              <Sparkline values={r.weekly} width={80} height={24} />
            </div>

            {/* Numbers */}
            <div className="text-right tabular-nums">
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                {r.fireCount.toLocaleString()}
                <span className="ml-1 text-[10px] font-normal text-[var(--text-muted)]">
                  fires
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                {r.userCount.toLocaleString()} users
                <span className="text-[var(--text-muted)]"> · </span>
                {formatPerUser(r.fireCount, r.userCount)}/user
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">
                {r.pctOfActive.toFixed(1)}% of active
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
