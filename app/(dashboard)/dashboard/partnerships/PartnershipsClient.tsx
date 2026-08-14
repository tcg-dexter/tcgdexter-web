"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SectionHeader } from "../components/Card";
import type {
  PartnerKind,
  PartnerPriority,
  PartnerProspect,
  PartnerStatus,
} from "./lib/types";
import {
  PARTNER_KINDS,
  PARTNER_PRIORITIES,
  PARTNER_STATUSES,
} from "./lib/types";

const PRIORITY_LABEL: Record<PartnerPriority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

const STATUS_LABEL: Record<PartnerStatus, string> = {
  prospect: "Prospect",
  contacted: "Contacted",
  replied: "Replied",
  partnered: "Partnered",
  declined: "Declined",
};

const KIND_LABEL: Record<PartnerKind, string> = {
  creator: "Creator",
  site: "Site",
  podcast: "Podcast",
  newsletter: "Newsletter",
};

const PRIORITY_DOT: Record<PartnerPriority, string> = {
  high: "bg-red-500",
  medium: "bg-amber-500",
  low: "bg-[var(--text-muted)]",
};

// One (label, href) per social field on the row — filters out the ones
// that are null so a row only advertises the links it actually has.
function socialLinks(p: PartnerProspect): { label: string; href: string }[] {
  const out: { label: string; href: string }[] = [];
  if (p.youtube_url) out.push({ label: "YT", href: p.youtube_url });
  if (p.twitch_url) out.push({ label: "Twitch", href: p.twitch_url });
  if (p.tiktok_url) out.push({ label: "TikTok", href: p.tiktok_url });
  if (p.x_url) out.push({ label: "X", href: p.x_url });
  if (p.instagram_url) out.push({ label: "IG", href: p.instagram_url });
  if (p.website_url) out.push({ label: "Site", href: p.website_url });
  return out;
}

export default function PartnershipsClient({
  partners,
}: {
  partners: PartnerProspect[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<Set<PartnerPriority>>(
    new Set(),
  );
  const [statusFilter, setStatusFilter] = useState<Set<PartnerStatus>>(
    new Set(),
  );
  const [kindFilter, setKindFilter] = useState<Set<PartnerKind>>(new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Optimistic priority/status overrides, keyed by partner id. Cleared on
  // router.refresh() picking up the real server data.
  const [overrides, setOverrides] = useState<
    Map<string, { priority?: PartnerPriority; status?: PartnerStatus }>
  >(new Map());

  function toggleInSet<T>(
    setter: React.Dispatch<React.SetStateAction<Set<T>>>,
    value: T,
  ) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return partners.filter((p) => {
      if (priorityFilter.size > 0 && !priorityFilter.has(p.priority)) return false;
      if (statusFilter.size > 0 && !statusFilter.has(p.status)) return false;
      if (kindFilter.size > 0 && !kindFilter.has(p.kind)) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.handle ?? "").toLowerCase().includes(q) ||
        p.note.toLowerCase().includes(q)
      );
    });
  }, [partners, query, priorityFilter, statusFilter, kindFilter]);

  async function patch(
    id: string,
    body: { priority?: PartnerPriority; status?: PartnerStatus },
  ) {
    setPendingId(id);
    setError(null);
    setOverrides((prev) => new Map(prev).set(id, { ...prev.get(id), ...body }));
    try {
      const res = await fetch(`/api/admin/partnerships/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      router.refresh();
    } catch (e) {
      // Revert the optimistic override on failure.
      setOverrides((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      setError(String(e));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        eyebrow="Partnerships"
        title="Creator & site prospects"
        meta={`${filtered.length} of ${partners.length}`}
      />

      <div className="flex flex-wrap items-center gap-3">
        <ChipGroup
          label="Priority"
          active={priorityFilter}
          options={PARTNER_PRIORITIES}
          labels={PRIORITY_LABEL}
          onToggle={(v) => toggleInSet(setPriorityFilter, v)}
        />
        <ChipGroup
          label="Status"
          active={statusFilter}
          options={PARTNER_STATUSES}
          labels={STATUS_LABEL}
          onToggle={(v) => toggleInSet(setStatusFilter, v)}
        />
        <ChipGroup
          label="Kind"
          active={kindFilter}
          options={PARTNER_KINDS}
          labels={KIND_LABEL}
          onToggle={(v) => toggleInSet(setKindFilter, v)}
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, handle or note"
          className="ml-auto min-w-[220px] rounded-md border border-black/10 dark:border-white/15 bg-white dark:bg-surface-elevated px-2.5 py-1.5 text-xs outline-none focus:border-black/30 dark:focus:border-white/30"
        />
      </div>

      {error ? (
        <p className="text-[11px] text-[var(--accent)]">{error}</p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-[var(--surface)] text-[var(--text-secondary)]">
            <tr>
              <Th>Name</Th>
              <Th>Kind</Th>
              <Th>Tier</Th>
              <Th>Reach</Th>
              <Th>Priority</Th>
              <Th>Status</Th>
              <Th>Note</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-[var(--text-muted)]">
                  No partners match these filters.
                </td>
              </tr>
            ) : (
              filtered.map((p) => {
                const effective = overrides.get(p.id);
                const priority = effective?.priority ?? p.priority;
                const status = effective?.status ?? p.status;
                const links = socialLinks(p);
                const busy = pendingId === p.id;
                return (
                  <tr
                    key={p.id}
                    className="border-t border-black/5 dark:border-white/10 hover:bg-[var(--surface)]/40"
                  >
                    <td className="px-2 py-2 align-top">
                      <div className="font-medium text-[var(--text-primary)]">
                        {p.name}
                      </div>
                      {p.handle ? (
                        <div className="text-[11px] text-[var(--text-muted)]">
                          @{p.handle.replace(/^@/, "")}
                        </div>
                      ) : null}
                      {links.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {links.map((l) => (
                            <a
                              key={l.label}
                              href={l.href}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[10px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline"
                            >
                              {l.label}
                            </a>
                          ))}
                        </div>
                      ) : null}
                      {!p.links_verified ? (
                        <a
                          href={p.source_url ?? undefined}
                          target="_blank"
                          rel="noreferrer"
                          title="Handle/links haven't been confirmed to resolve yet — check before reaching out"
                          className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400 hover:underline"
                        >
                          ⚠ unverified
                        </a>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 align-top text-[var(--text-secondary)]">
                      {KIND_LABEL[p.kind]}
                    </td>
                    <td className="px-2 py-2 align-top text-[var(--text-secondary)]">
                      {p.tier ? p.tier[0].toUpperCase() + p.tier.slice(1) : "—"}
                    </td>
                    <td className="px-2 py-2 align-top text-[var(--text-secondary)] max-w-[16ch]">
                      {p.reach_note ?? "—"}
                    </td>
                    <td className="px-2 py-2 align-top">
                      <label className="inline-flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOT[priority]}`}
                        />
                        <select
                          value={priority}
                          disabled={busy}
                          onChange={(e) =>
                            patch(p.id, { priority: e.target.value as PartnerPriority })
                          }
                          className="rounded-md border border-black/10 dark:border-white/15 bg-white dark:bg-surface-elevated px-1.5 py-1 text-[11px] disabled:opacity-50"
                        >
                          {PARTNER_PRIORITIES.map((v) => (
                            <option key={v} value={v}>
                              {PRIORITY_LABEL[v]}
                            </option>
                          ))}
                        </select>
                      </label>
                    </td>
                    <td className="px-2 py-2 align-top">
                      <select
                        value={status}
                        disabled={busy}
                        onChange={(e) =>
                          patch(p.id, { status: e.target.value as PartnerStatus })
                        }
                        className="rounded-md border border-black/10 dark:border-white/15 bg-white dark:bg-surface-elevated px-1.5 py-1 text-[11px] disabled:opacity-50"
                      >
                        {PARTNER_STATUSES.map((v) => (
                          <option key={v} value={v}>
                            {STATUS_LABEL[v]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2 align-top text-[var(--text-secondary)] max-w-[32ch]">
                      {p.note}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">
      {children}
    </th>
  );
}

function ChipGroup<T extends string>({
  label,
  active,
  options,
  labels,
  onToggle,
}: {
  label: string;
  active: Set<T>;
  options: readonly T[];
  labels: Record<T, string>;
  onToggle: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </span>
      {options.map((opt) => {
        const isActive = active.has(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            aria-pressed={isActive}
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold transition ${
              isActive
                ? "bg-black dark:bg-white text-white dark:text-black"
                : "border border-black/10 dark:border-white/15 bg-white dark:bg-surface-elevated text-[var(--text-secondary)] hover:bg-[var(--surface)]"
            }`}
          >
            {labels[opt]}
          </button>
        );
      })}
    </div>
  );
}
