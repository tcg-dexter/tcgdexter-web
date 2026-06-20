import type { ActivityData, ActivityKind } from "../lib/activity";
import { links } from "../lib/links";
import { Card, ErrorBox, Initials, relTime } from "./Card";

type Props = { data: ActivityData | { error: string } };

const KIND_META: Record<
  ActivityKind,
  { label: string; chip: string; verb: string }
> = {
  signup: {
    label: "signup",
    chip: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    verb: "joined",
  },
  saved_deck: {
    label: "deck saved",
    chip: "bg-sky-50 text-sky-700 ring-sky-200",
    verb: "saved a deck",
  },
  match: {
    label: "match",
    chip: "bg-amber-50 text-amber-700 ring-amber-200",
    verb: "logged a match",
  },
};

export default function ActivityFeed({ data }: Props) {
  if ("error" in data) return <ErrorBox error={data.error} />;

  return (
    <Card variant="elevated">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex items-baseline gap-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Recent activity
          </div>
          <span className="text-[11px] tabular-nums text-[var(--text-muted)]">
            · {data.events.length}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <a
            href={links.supabase.auth}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline"
          >
            users ↗
          </a>
          <a
            href={links.supabase.table("saved_decks")}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline"
          >
            decks ↗
          </a>
          <a
            href={links.supabase.table("matches")}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline"
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
        <ul className="-mx-1 divide-y divide-black/5 text-xs">
          {data.events.map((ev, i) => {
            const meta = KIND_META[ev.kind];
            return (
              <li
                key={`${ev.kind}-${i}-${ev.at}`}
                className="flex items-center gap-2.5 rounded-md px-1 py-2 transition hover:bg-[var(--surface)]/50"
              >
                <Initials from={ev.primary} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0">
                    <span className="truncate font-medium text-[var(--text-primary)]">
                      {ev.primary}
                    </span>
                    <span className="text-[11px] text-[var(--text-muted)]">
                      {meta.verb}
                    </span>
                  </div>
                  {ev.secondary ? (
                    <div className="truncate text-[11px] text-[var(--text-muted)]">
                      {ev.secondary}
                    </div>
                  ) : null}
                </div>
                <span
                  className={`hidden shrink-0 rounded-full px-1.5 py-[1px] text-[10px] font-medium ring-1 sm:inline ${meta.chip}`}
                >
                  {meta.label}
                </span>
                <span className="shrink-0 tabular-nums text-[11px] text-[var(--text-muted)]">
                  {relTime(ev.at)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
