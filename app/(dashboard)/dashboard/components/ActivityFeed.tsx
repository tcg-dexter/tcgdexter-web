import type { ActivityData, ActivityKind } from "../lib/activity";
import { links } from "../lib/links";
import { Card, ErrorBox, relTime } from "./Card";

type Props = { data: ActivityData | { error: string } };

const KIND_META: Record<
  ActivityKind,
  { label: string; dot: string; chip: string }
> = {
  signup: {
    label: "signup",
    dot: "bg-emerald-500",
    chip: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  },
  saved_deck: {
    label: "deck saved",
    dot: "bg-sky-500",
    chip: "bg-sky-50 text-sky-700 ring-sky-200",
  },
  match: {
    label: "match",
    dot: "bg-amber-500",
    chip: "bg-amber-50 text-amber-700 ring-amber-200",
  },
};

export default function ActivityFeed({ data }: Props) {
  if ("error" in data) return <ErrorBox error={data.error} />;

  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Recent activity · {data.events.length}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <a
            href={links.supabase.auth}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--text-secondary)] hover:underline"
          >
            users ↗
          </a>
          <a
            href={links.supabase.table("saved_decks")}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--text-secondary)] hover:underline"
          >
            decks ↗
          </a>
          <a
            href={links.supabase.table("matches")}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--text-secondary)] hover:underline"
          >
            matches ↗
          </a>
        </div>
      </div>

      {data.events.length === 0 ? (
        <div className="py-6 text-center text-xs text-[var(--text-muted)]">
          No activity yet — once users sign up, save decks, or log matches it will appear here.
        </div>
      ) : (
        <ul className="divide-y divide-black/5 text-xs">
          {data.events.map((ev, i) => {
            const meta = KIND_META[ev.kind];
            return (
              <li key={`${ev.kind}-${i}-${ev.at}`} className="py-1.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`shrink-0 h-1.5 w-1.5 rounded-full ${meta.dot}`}
                    aria-hidden
                  />
                  <span
                    className={`shrink-0 rounded-full px-1.5 py-[1px] text-[10px] font-medium ring-1 ${meta.chip}`}
                  >
                    {meta.label}
                  </span>
                  <span className="truncate text-[var(--text-primary)]">
                    {ev.primary}
                  </span>
                  {ev.secondary ? (
                    <span className="hidden truncate text-[var(--text-muted)] sm:inline">
                      · {ev.secondary}
                    </span>
                  ) : null}
                  <span className="ml-auto shrink-0 tabular-nums text-[var(--text-muted)]">
                    {relTime(ev.at)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
