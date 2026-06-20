"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { CrmCampaign, CrmContact } from "./lib/types";

type SortKey =
  | "name"
  | "signup_at"
  | "last_sign_in_at"
  | "deck_count"
  | "match_count";

type Direction = "asc" | "desc";

type ViewKey = "new7" | "new30" | "active" | "dormant" | "all";

type ViewDef = {
  key: ViewKey;
  label: string;
  hint: string;
  // Default sort applied when this view is picked. Users can re-sort after.
  defaultSort: SortKey;
  defaultDirection: Direction;
  predicate: (c: CrmContact, now: number) => boolean;
};

const DAY = 24 * 60 * 60 * 1000;

// Variations on the "user heartbeat" view. Default is "new7" — the v1 use
// case is starting an email campaign against fresh signups. Other views
// surface the same table sliced for different communications questions:
// who's engaged, who's slipping, the full base.
const VIEWS: ViewDef[] = [
  {
    key: "new7",
    label: "New (7d)",
    hint: "Signed up in the last 7 days",
    defaultSort: "signup_at",
    defaultDirection: "desc",
    predicate: (c, now) =>
      !!c.signup_at && now - new Date(c.signup_at).getTime() < 7 * DAY,
  },
  {
    key: "new30",
    label: "New (30d)",
    hint: "Signed up in the last 30 days",
    defaultSort: "signup_at",
    defaultDirection: "desc",
    predicate: (c, now) =>
      !!c.signup_at && now - new Date(c.signup_at).getTime() < 30 * DAY,
  },
  {
    key: "active",
    label: "Active",
    hint: "Logged in within the last 14 days",
    defaultSort: "last_sign_in_at",
    defaultDirection: "desc",
    predicate: (c, now) =>
      !!c.last_sign_in_at &&
      now - new Date(c.last_sign_in_at).getTime() < 14 * DAY,
  },
  {
    key: "dormant",
    label: "Dormant",
    hint: "No login in 30+ days",
    defaultSort: "last_sign_in_at",
    defaultDirection: "asc",
    predicate: (c, now) =>
      !c.last_sign_in_at ||
      now - new Date(c.last_sign_in_at).getTime() >= 30 * DAY,
  },
  {
    key: "all",
    label: "All",
    hint: "Every signed-up user",
    defaultSort: "last_sign_in_at",
    defaultDirection: "desc",
    predicate: () => true,
  },
];

function compareNullable<T extends string | number>(
  a: T | null,
  b: T | null,
  asc: boolean,
): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (a < b) return asc ? -1 : 1;
  return asc ? 1 : -1;
}

function nameOf(c: CrmContact): string {
  return c.display_name?.trim() || c.username || c.email;
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < DAY) return "today";
  if (diff < 2 * DAY) return "yesterday";
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  if (diff < 30 * DAY) return `${Math.floor(diff / (7 * DAY))}w ago`;
  return d.toISOString().slice(0, 10);
}

export default function CrmContactsClient({
  contacts,
  campaignTargets,
}: {
  contacts: CrmContact[];
  campaignTargets: CrmCampaign[];
}) {
  const router = useRouter();
  const [view, setView] = useState<ViewKey>("new7");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("signup_at");
  const [direction, setDirection] = useState<Direction>("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetCampaign, setTargetCampaign] = useState<string>(
    campaignTargets[0]?.id ?? "",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Optimistic overrides applied to active_sends on each contact. Keyed by
  // send_id — null means "unsent", a timestamp string means "sent at X".
  const [sendOverrides, setSendOverrides] = useState<Map<string, string | null>>(
    new Map(),
  );
  const [togglingSendId, setTogglingSendId] = useState<string | null>(null);

  const activeView = VIEWS.find((v) => v.key === view) ?? VIEWS[0];

  const filtered = useMemo(() => {
    const now = Date.now();
    const q = query.trim().toLowerCase();
    const rows = contacts.filter((c) => {
      if (!activeView.predicate(c, now)) return false;
      if (!q) return true;
      return (
        c.email.toLowerCase().includes(q) ||
        (c.username ?? "").toLowerCase().includes(q) ||
        (c.display_name ?? "").toLowerCase().includes(q)
      );
    });
    const asc = direction === "asc";
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case "name":
          return compareNullable(nameOf(a).toLowerCase(), nameOf(b).toLowerCase(), asc);
        case "signup_at":
          return compareNullable(a.signup_at, b.signup_at, asc);
        case "last_sign_in_at":
          return compareNullable(a.last_sign_in_at, b.last_sign_in_at, asc);
        case "deck_count":
          return compareNullable(a.deck_count, b.deck_count, asc);
        case "match_count":
          return compareNullable(a.match_count, b.match_count, asc);
      }
    });
  }, [contacts, activeView, query, sortKey, direction]);

  function chooseView(next: ViewKey) {
    setView(next);
    setSelected(new Set());
    const def = VIEWS.find((v) => v.key === next);
    if (def) {
      setSortKey(def.defaultSort);
      setDirection(def.defaultDirection);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = filtered.every((c) => next.has(c.id));
      if (allSelected) filtered.forEach((c) => next.delete(c.id));
      else filtered.forEach((c) => next.add(c.id));
      return next;
    });
  }

  function setSort(key: SortKey) {
    if (key === sortKey) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDirection(key === "name" ? "asc" : "desc");
    }
  }

  async function addToCampaign() {
    if (!targetCampaign || selected.size === 0) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/crm/campaigns/${targetCampaign}/recipients`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ user_ids: Array.from(selected) }),
        },
      );
      if (!res.ok) throw new Error(`${res.status}`);
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  }

  function effectiveSentAt(sendId: string, original: string | null): string | null {
    return sendOverrides.has(sendId) ? sendOverrides.get(sendId)! : original;
  }

  async function toggleSend(sendId: string, currentSentAt: string | null) {
    const nextSent = currentSentAt === null;
    const nextValue = nextSent ? new Date().toISOString() : null;
    setTogglingSendId(sendId);
    // Optimistic override.
    setSendOverrides((prev) => new Map(prev).set(sendId, nextValue));
    try {
      const res = await fetch(`/api/admin/crm/sends/${sendId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sent: nextSent }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
    } catch (e) {
      // Revert.
      setSendOverrides((prev) => {
        const next = new Map(prev);
        next.delete(sendId);
        return next;
      });
      setError(String(e));
    } finally {
      setTogglingSendId(null);
    }
  }

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((c) => selected.has(c.id));

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Users
        </h2>
        <span className="text-[11px] text-[var(--text-muted)]">
          {filtered.length} of {contacts.length} · {activeView.hint}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {VIEWS.map((v) => {
          const active = v.key === view;
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => chooseView(v.key)}
              title={v.hint}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                active
                  ? "bg-black text-white"
                  : "border border-black/10 bg-white text-[var(--text-secondary)] hover:bg-[var(--surface)]"
              }`}
            >
              {v.label}
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, username or email"
            className="min-w-[220px] rounded-md border border-black/10 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-black/30"
          />
          <Link
            href="/dashboard/crm/campaigns/new"
            className="rounded-md bg-black px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
          >
            New campaign
          </Link>
        </div>
      </div>

      {selected.size > 0 ? (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-md border border-black/10 bg-white p-2 shadow-sm">
          <span className="text-xs font-semibold">{selected.size} selected</span>
          <span className="text-[11px] text-[var(--text-muted)]">Add to campaign:</span>
          {campaignTargets.length === 0 ? (
            <Link
              href="/dashboard/crm/campaigns/new"
              className="text-xs font-semibold underline underline-offset-4"
            >
              create one first ↗
            </Link>
          ) : (
            <>
              <select
                value={targetCampaign}
                onChange={(e) => setTargetCampaign(e.target.value)}
                className="rounded-md border border-black/10 bg-white px-2 py-1 text-xs"
              >
                {campaignTargets.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.status})
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={pending}
                onClick={addToCampaign}
                className="rounded-md bg-black px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
              >
                {pending ? "Adding…" : "Add"}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto text-[11px] text-[var(--text-muted)] hover:underline"
          >
            clear
          </button>
          {error ? (
            <span className="basis-full text-[11px] text-[var(--accent)]">{error}</span>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-black/8 bg-white shadow-sm">
        <table className="min-w-full text-xs">
          <thead className="bg-[var(--surface)] text-[var(--text-secondary)]">
            <tr>
              <th className="w-8 px-2 py-2 text-left">
                <input
                  type="checkbox"
                  aria-label="Select all visible"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                />
              </th>
              <SortableTh label="Contact" sortKey="name" current={sortKey} direction={direction} onSort={setSort} />
              <SortableTh label="Signed up" sortKey="signup_at" current={sortKey} direction={direction} onSort={setSort} />
              <SortableTh label="Last login" sortKey="last_sign_in_at" current={sortKey} direction={direction} onSort={setSort} />
              <SortableTh label="Decks" sortKey="deck_count" current={sortKey} direction={direction} onSort={setSort} align="right" />
              <SortableTh label="Matches" sortKey="match_count" current={sortKey} direction={direction} onSort={setSort} align="right" />
              <th className="px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">
                Campaigns
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-[var(--text-muted)]">
                  No contacts match this view.
                </td>
              </tr>
            ) : (
              filtered.map((c) => (
                <tr key={c.id} className="border-t border-black/5 hover:bg-[var(--surface)]/40">
                  <td className="px-2 py-2 align-top">
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                      aria-label={`Select ${c.email}`}
                    />
                  </td>
                  <td className="px-2 py-2 align-top">
                    {c.display_name?.trim() ? (
                      <>
                        <div className="font-medium text-[var(--text-primary)]">
                          {c.display_name.trim()}
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)]">{c.email}</div>
                      </>
                    ) : (
                      <div className="font-medium text-[var(--text-primary)]">{c.email}</div>
                    )}
                  </td>
                  <td className="px-2 py-2 align-top text-[var(--text-secondary)]">
                    {formatRelative(c.signup_at)}
                  </td>
                  <td className="px-2 py-2 align-top text-[var(--text-secondary)]">
                    {formatRelative(c.last_sign_in_at)}
                  </td>
                  <td className="px-2 py-2 align-top text-right tabular-nums">{c.deck_count}</td>
                  <td className="px-2 py-2 align-top text-right tabular-nums">{c.match_count}</td>
                  <td className="px-2 py-2 align-top">
                    {c.active_sends.length === 0 ? (
                      <span className="text-[var(--text-muted)]">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {c.active_sends.map((s) => {
                          const sentAt = effectiveSentAt(s.send_id, s.sent_at);
                          const isSent = sentAt !== null;
                          const busy = togglingSendId === s.send_id;
                          return (
                            <button
                              key={s.send_id}
                              type="button"
                              disabled={busy}
                              onClick={() => toggleSend(s.send_id, sentAt)}
                              title={
                                isSent
                                  ? `Sent ${formatRelative(sentAt)} — click to unmark`
                                  : "Click to mark sent"
                              }
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition disabled:opacity-50 ${
                                isSent
                                  ? "bg-green-100 text-green-800 hover:bg-green-200"
                                  : "border border-black/10 bg-white text-[var(--text-secondary)] hover:bg-[var(--surface)]"
                              }`}
                            >
                              <span aria-hidden>{isSent ? "✓" : "○"}</span>
                              <span className="max-w-[14ch] truncate">{s.campaign_name}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SortableTh({
  label,
  sortKey,
  current,
  direction,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  direction: Direction;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = current === sortKey;
  return (
    <th className={`px-2 py-2 text-[11px] font-semibold uppercase tracking-wider ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-[var(--text-primary)] ${active ? "text-[var(--text-primary)]" : ""}`}
      >
        <span>{label}</span>
        {active ? <span aria-hidden>{direction === "asc" ? "↑" : "↓"}</span> : null}
      </button>
    </th>
  );
}
