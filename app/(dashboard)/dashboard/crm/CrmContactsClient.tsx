"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { CrmCampaign, CrmContact } from "./lib/types";

type SortKey =
  | "name"
  | "last_sign_in_at"
  | "deck_count"
  | "match_count"
  | "last_sent_at";

type Direction = "asc" | "desc";

function compareNullable<T extends string | number>(
  a: T | null,
  b: T | null,
  asc: boolean,
): number {
  // Null values sort last regardless of direction — they're "no signal".
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
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return "today";
  if (diff < 2 * day) return "yesterday";
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  if (diff < 30 * day) return `${Math.floor(diff / (7 * day))}w ago`;
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
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("last_sign_in_at");
  const [direction, setDirection] = useState<Direction>("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetCampaign, setTargetCampaign] = useState<string>(
    campaignTargets[0]?.id ?? "",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? contacts.filter(
          (c) =>
            c.email.toLowerCase().includes(q) ||
            (c.username ?? "").toLowerCase().includes(q) ||
            (c.display_name ?? "").toLowerCase().includes(q),
        )
      : contacts;
    const asc = direction === "asc";
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case "name":
          return compareNullable(nameOf(a).toLowerCase(), nameOf(b).toLowerCase(), asc);
        case "last_sign_in_at":
          return compareNullable(a.last_sign_in_at, b.last_sign_in_at, asc);
        case "deck_count":
          return compareNullable(a.deck_count, b.deck_count, asc);
        case "match_count":
          return compareNullable(a.match_count, b.match_count, asc);
        case "last_sent_at":
          return compareNullable(
            a.last_send?.sent_at ?? null,
            b.last_send?.sent_at ?? null,
            asc,
          );
      }
    });
  }, [contacts, query, sortKey, direction]);

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
      // Numeric / date columns default to descending; name to ascending.
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
      router.push(`/dashboard/crm/campaigns/${targetCampaign}`);
    } catch (e) {
      setError(String(e));
      setPending(false);
    }
  }

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((c) => selected.has(c.id));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, username or email"
          className="min-w-[220px] flex-1 rounded-md border border-black/10 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-black/30"
        />
        <Link
          href="/dashboard/crm/campaigns"
          className="rounded-md border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-[var(--surface)]"
        >
          Campaigns
        </Link>
        <Link
          href="/dashboard/crm/campaigns/new"
          className="rounded-md bg-black px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
        >
          New campaign
        </Link>
      </div>

      {selected.size > 0 ? (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-md border border-black/10 bg-white p-2 shadow-sm">
          <span className="text-xs font-semibold">
            {selected.size} selected
          </span>
          <span className="text-[11px] text-[var(--text-muted)]">
            Add to campaign:
          </span>
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
              <SortableTh label="Last login" sortKey="last_sign_in_at" current={sortKey} direction={direction} onSort={setSort} />
              <SortableTh label="Decks" sortKey="deck_count" current={sortKey} direction={direction} onSort={setSort} align="right" />
              <SortableTh label="Matches" sortKey="match_count" current={sortKey} direction={direction} onSort={setSort} align="right" />
              <SortableTh label="Last sent" sortKey="last_sent_at" current={sortKey} direction={direction} onSort={setSort} />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-[var(--text-muted)]">
                  No contacts match.
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
                    <div className="font-medium text-[var(--text-primary)]">{nameOf(c)}</div>
                    <div className="text-[11px] text-[var(--text-muted)]">{c.email}</div>
                  </td>
                  <td className="px-2 py-2 align-top text-[var(--text-secondary)]">
                    {formatRelative(c.last_sign_in_at)}
                  </td>
                  <td className="px-2 py-2 align-top text-right tabular-nums">
                    {c.deck_count}
                  </td>
                  <td className="px-2 py-2 align-top text-right tabular-nums">
                    {c.match_count}
                  </td>
                  <td className="px-2 py-2 align-top">
                    {c.last_send ? (
                      <div>
                        <div className="text-[var(--text-primary)]">
                          {c.last_send.campaign_name}
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)]">
                          {formatRelative(c.last_send.sent_at)}
                        </div>
                      </div>
                    ) : (
                      <span className="text-[var(--text-muted)]">never</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
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
