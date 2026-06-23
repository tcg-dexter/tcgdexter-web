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

// Each category gets a three-part palette: chip background, engagement-bar
// fill, and sparkline stroke. Pinning the bar and sparkline to the chip's
// hue gives every row a single colour identity so you can scan vertically
// and see at a glance which surface dominates the column.
const CATEGORY_CHIP: Record<Category, string> = {
  Analyze: "bg-violet-100 text-violet-700",
  Decks: "bg-sky-100 text-sky-700",
  Matches: "bg-amber-100 text-amber-700",
  Auth: "bg-emerald-100 text-emerald-700",
  Other: "bg-gray-100 text-gray-700",
};

const CATEGORY_BAR: Record<Category, string> = {
  Analyze: "bg-violet-500",
  Decks: "bg-sky-500",
  Matches: "bg-amber-500",
  Auth: "bg-emerald-500",
  Other: "bg-gray-400",
};

const CATEGORY_STROKE: Record<Category, string> = {
  Analyze: "#8b5cf6",
  Decks: "#0ea5e9",
  Matches: "#f59e0b",
  Auth: "#10b981",
  Other: "#9ca3af",
};

function formatPerUser(fires: number, users: number): string {
  if (users === 0) return "—";
  const ratio = fires / users;
  return ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(1);
}

function DeltaChip({
  delta,
  deltaPct,
}: {
  delta: number;
  deltaPct: number | null;
}) {
  if (delta === 0 && (deltaPct == null || deltaPct === 0)) {
    return (
      <span className="inline-flex items-center rounded-full bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">
        – flat
      </span>
    );
  }
  const up = delta > 0;
  // Fall back to absolute delta when prior is 0 (no % defined).
  const label =
    deltaPct != null
      ? `${up ? "+" : ""}${deltaPct.toFixed(0)}%`
      : `${up ? "+" : ""}${delta}`;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
        up ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
      }`}
    >
      <span aria-hidden>{up ? "▲" : "▼"}</span>
      {label.replace(/^-/, "")}
    </span>
  );
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
        const chip = CATEGORY_CHIP[category];
        const barClass = CATEGORY_BAR[category];
        const stroke = CATEGORY_STROKE[category];
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
                  className={`shrink-0 rounded-full px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wider ${chip}`}
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
                  className={`h-full rounded-full ${barClass}`}
                  style={{ width: `${widthPct}%` }}
                />
              </div>
              <Sparkline values={r.weekly} width={80} height={24} stroke={stroke} />
            </div>

            {/* Numbers */}
            <div className="text-right tabular-nums">
              <div className="flex items-center justify-end gap-1.5">
                <DeltaChip delta={r.fireCountDelta} deltaPct={r.fireCountDeltaPct} />
                <div className="text-sm font-semibold text-[var(--text-primary)]">
                  {r.fireCount.toLocaleString()}
                  <span className="ml-1 text-[10px] font-normal text-[var(--text-muted)]">
                    fires
                  </span>
                </div>
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
