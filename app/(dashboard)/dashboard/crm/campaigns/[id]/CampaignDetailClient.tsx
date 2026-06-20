"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type {
  CampaignStatus,
  CrmCampaign,
  CrmCampaignRecipient,
  RecipientType,
} from "../../lib/types";

function nameOf(r: CrmCampaignRecipient): string {
  return r.display_name?.trim() || r.username || r.email;
}

type RecipientSortKey = "unsent_first" | "name" | "sent_at_desc";

// Default "Unsent first" surfaces the next action — rows that still need
// to be marked sent — at the top of the table. Secondary sorts cover the
// other two natural ways of looking at the same data.
const RECIPIENT_SORTS: { key: RecipientSortKey; label: string }[] = [
  { key: "unsent_first", label: "Unsent first" },
  { key: "name", label: "Name (A–Z)" },
  { key: "sent_at_desc", label: "Recently sent" },
];

function compareName(a: CrmCampaignRecipient, b: CrmCampaignRecipient): number {
  return nameOf(a).toLowerCase().localeCompare(nameOf(b).toLowerCase());
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function StatusBadge({ status }: { status: CampaignStatus }) {
  const styles: Record<CampaignStatus, string> = {
    draft: "bg-[var(--surface)] text-[var(--text-secondary)]",
    sending: "bg-yellow-100 text-yellow-800",
    complete: "bg-green-100 text-green-800",
  };
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${styles[status]}`}
    >
      {status}
    </span>
  );
}

export default function CampaignDetailClient({
  campaign: initialCampaign,
  initialRecipients,
}: {
  campaign: CrmCampaign;
  initialRecipients: CrmCampaignRecipient[];
}) {
  const router = useRouter();
  const [campaign, setCampaign] = useState(initialCampaign);
  const [recipients, setRecipients] = useState(initialRecipients);
  const [name, setName] = useState(campaign.name);
  const [subject, setSubject] = useState(campaign.subject);
  const [body, setBody] = useState(campaign.body);
  const [recipientType, setRecipientType] = useState<RecipientType>(
    campaign.recipient_type,
  );
  const [windowStart, setWindowStart] = useState(campaign.signup_window_start ?? "");
  const [windowEnd, setWindowEnd] = useState(campaign.signup_window_end ?? "");
  const [savingMeta, setSavingMeta] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [recipientSort, setRecipientSort] =
    useState<RecipientSortKey>("unsent_first");

  // Effective sent timestamp accounting for optimistic toggles isn't tracked
  // in the recipients array directly (the toggleSent handler rewrites
  // recipients in place), so we sort on r.sent_at as-is. Order updates
  // re-derive on every render via useMemo when recipients/sort change.
  const sortedRecipients = useMemo(() => {
    const rows = [...recipients];
    switch (recipientSort) {
      case "unsent_first":
        return rows.sort((a, b) => {
          if ((a.sent_at === null) !== (b.sent_at === null)) {
            return a.sent_at === null ? -1 : 1;
          }
          if (a.sent_at && b.sent_at) {
            // Within the sent group, newest at the top.
            return b.sent_at.localeCompare(a.sent_at);
          }
          return compareName(a, b);
        });
      case "name":
        return rows.sort(compareName);
      case "sent_at_desc":
        return rows.sort((a, b) => {
          if ((a.sent_at !== null) !== (b.sent_at !== null)) {
            return a.sent_at !== null ? -1 : 1;
          }
          if (a.sent_at && b.sent_at) {
            return b.sent_at.localeCompare(a.sent_at);
          }
          return compareName(a, b);
        });
    }
  }, [recipients, recipientSort]);

  const sentCount = useMemo(
    () => recipients.filter((r) => r.sent_at !== null).length,
    [recipients],
  );
  const totalCount = recipients.length;
  const allSent = totalCount > 0 && sentCount === totalCount;

  const windowInvalid =
    recipientType === "signup_window" &&
    (!windowStart || !windowEnd || windowEnd < windowStart);
  const dirtyMeta =
    name !== campaign.name ||
    subject !== campaign.subject ||
    body !== campaign.body ||
    recipientType !== campaign.recipient_type ||
    (recipientType === "signup_window" &&
      (windowStart !== (campaign.signup_window_start ?? "") ||
        windowEnd !== (campaign.signup_window_end ?? "")));

  async function patchCampaign(patch: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/admin/crm/campaigns/${campaign.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error ?? `HTTP ${res.status}`);
    }
  }

  async function saveMeta() {
    if (windowInvalid) return;
    setSavingMeta(true);
    try {
      const patch: Record<string, unknown> = {
        name,
        subject,
        body,
        recipient_type: recipientType,
      };
      if (recipientType === "signup_window") {
        patch.signup_window_start = windowStart;
        patch.signup_window_end = windowEnd;
      } else {
        patch.signup_window_start = null;
        patch.signup_window_end = null;
      }
      await patchCampaign(patch);
      setCampaign((c) => ({
        ...c,
        name,
        subject,
        body,
        recipient_type: recipientType,
        signup_window_start:
          recipientType === "signup_window" ? windowStart : null,
        signup_window_end:
          recipientType === "signup_window" ? windowEnd : null,
      }));
      // A rule change can pull in new recipients on the server — refresh
      // the page-level data so the recipient table reflects the new state.
      router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingMeta(false);
    }
  }

  async function changeStatus(status: CampaignStatus) {
    try {
      await patchCampaign({ status });
      setCampaign((c) => ({
        ...c,
        status,
        completed_at: status === "complete" ? new Date().toISOString() : null,
      }));
    } catch (e) {
      setError(String(e));
    }
  }

  async function toggleSent(sendId: string, current: string | null) {
    const nextSent = current === null;
    // Optimistic update.
    setRecipients((rs) =>
      rs.map((r) =>
        r.send_id === sendId
          ? { ...r, sent_at: nextSent ? new Date().toISOString() : null }
          : r,
      ),
    );
    try {
      const res = await fetch(`/api/admin/crm/sends/${sendId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sent: nextSent }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      // Revert.
      setRecipients((rs) =>
        rs.map((r) => (r.send_id === sendId ? { ...r, sent_at: current } : r)),
      );
      setError(String(e));
    }
  }

  async function markSelectedSent() {
    if (selected.size === 0) return;
    setBulkPending(true);
    const ids = Array.from(selected).filter((id) => {
      const r = recipients.find((x) => x.send_id === id);
      return r && r.sent_at === null;
    });
    try {
      await Promise.all(
        ids.map((sendId) =>
          fetch(`/api/admin/crm/sends/${sendId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sent: true }),
          }),
        ),
      );
      const now = new Date().toISOString();
      setRecipients((rs) =>
        rs.map((r) => (ids.includes(r.send_id) ? { ...r, sent_at: now } : r)),
      );
      setSelected(new Set());
    } catch (e) {
      setError(String(e));
    } finally {
      setBulkPending(false);
    }
  }

  async function deleteCampaign() {
    const recipientWord = totalCount === 1 ? "recipient" : "recipients";
    const tail =
      totalCount > 0
        ? ` and remove all ${totalCount} ${recipientWord}.`
        : ".";
    if (
      !window.confirm(
        `Delete the campaign "${campaign.name}"? This will permanently delete the campaign${tail} This cannot be undone.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/crm/campaigns/${campaign.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      router.push("/dashboard/crm/campaigns");
    } catch (e) {
      setError(String(e));
      setDeleting(false);
    }
  }

  async function removeRecipient(sendId: string) {
    const prev = recipients;
    setRecipients((rs) => rs.filter((r) => r.send_id !== sendId));
    try {
      const res = await fetch(`/api/admin/crm/sends/${sendId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setRecipients(prev);
      setError(String(e));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link
          href="/dashboard/crm/campaigns"
          className="text-[11px] text-[var(--text-muted)] hover:underline"
        >
          ← Campaigns
        </Link>
        <StatusBadge status={campaign.status} />
        <span className="text-[11px] text-[var(--text-muted)]">
          {sentCount} of {totalCount} sent
        </span>
        {allSent && campaign.status !== "complete" ? (
          <button
            type="button"
            onClick={() => changeStatus("complete")}
            className="rounded-md bg-green-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:opacity-90"
          >
            Mark complete
          </button>
        ) : null}
        {campaign.status === "complete" ? (
          <button
            type="button"
            onClick={() => changeStatus(allSent ? "sending" : "draft")}
            className="text-[11px] text-[var(--text-muted)] hover:underline"
          >
            Reopen
          </button>
        ) : null}
        <button
          type="button"
          disabled={deleting}
          onClick={deleteCampaign}
          className="ml-auto text-[11px] text-[var(--text-muted)] hover:text-[var(--accent)] hover:underline disabled:opacity-50"
        >
          {deleting ? "Deleting…" : "Delete campaign"}
        </button>
      </div>

      <section className="flex flex-col gap-3 rounded-xl border border-black/8 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Name
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-black/10 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-black/30"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Subject
            </span>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="rounded-md border border-black/10 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-black/30"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Body
            </span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="rounded-md border border-black/10 bg-white px-2.5 py-1.5 text-xs font-mono outline-none focus:border-black/30"
            />
          </label>

          {/* Recipient rule. Editing the rule re-syncs on the server: the
              PATCH handler calls syncCampaignRecipients() after the update,
              and router.refresh() below pulls the new recipient set. */}
          <fieldset className="flex flex-col gap-2 rounded-xl border border-black/8 bg-white/60 p-3">
            <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Recipients
            </legend>
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="radio"
                  name="recipient_type"
                  value="manual"
                  checked={recipientType === "manual"}
                  onChange={() => setRecipientType("manual")}
                />
                <span className="font-medium">Manual</span>
                <span className="text-[11px] text-[var(--text-muted)]">
                  Pick recipients yourself from the contacts dashboard.
                </span>
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="radio"
                  name="recipient_type"
                  value="signup_window"
                  checked={recipientType === "signup_window"}
                  onChange={() => setRecipientType("signup_window")}
                />
                <span className="font-medium">Signup window</span>
                <span className="text-[11px] text-[var(--text-muted)]">
                  Auto-enroll every user who signs up in this date range. New
                  signups keep getting added until the campaign is marked
                  complete.
                </span>
              </label>
            </div>
            {recipientType === "signup_window" ? (
              <div className="flex flex-wrap items-end gap-3 pt-1">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    From
                  </span>
                  <input
                    type="date"
                    value={windowStart}
                    onChange={(e) => setWindowStart(e.target.value)}
                    className="rounded-md border border-black/10 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-black/30"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    To
                  </span>
                  <input
                    type="date"
                    value={windowEnd}
                    onChange={(e) => setWindowEnd(e.target.value)}
                    className="rounded-md border border-black/10 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-black/30"
                  />
                </label>
                <span className="text-[11px] text-[var(--text-muted)]">
                  Inclusive — UTC days.
                </span>
                {windowInvalid ? (
                  <span className="basis-full text-[11px] text-[var(--accent)]">
                    End date must be on or after the start date.
                  </span>
                ) : null}
              </div>
            ) : null}
          </fieldset>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!dirtyMeta || savingMeta || windowInvalid}
            onClick={saveMeta}
            className="rounded-md bg-black px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {savingMeta ? "Saving…" : "Save changes"}
          </button>
          {campaign.recipient_type === "manual" ? (
            <Link
              href="/dashboard/crm"
              className="text-xs text-[var(--text-muted)] hover:underline"
            >
              Add more recipients from Contacts →
            </Link>
          ) : (
            <span className="text-xs text-[var(--text-muted)]">
              Recipients are managed by the rule above.
            </span>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Recipients
          </h2>
          <div className="flex items-center gap-2">
            <label
              htmlFor="recipient-sort"
              className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]"
            >
              Sort
            </label>
            <select
              id="recipient-sort"
              value={recipientSort}
              onChange={(e) =>
                setRecipientSort(e.target.value as RecipientSortKey)
              }
              className="rounded-md border border-black/10 bg-white px-2 py-1 text-[11px]"
            >
              {RECIPIENT_SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
            {selected.size > 0 ? (
              <button
                type="button"
                disabled={bulkPending}
                onClick={markSelectedSent}
                className="rounded-md bg-black px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
              >
                {bulkPending ? "Marking…" : `Mark ${selected.size} sent`}
              </button>
            ) : null}
          </div>
        </div>

        {error ? <div className="text-[11px] text-[var(--accent)]">{error}</div> : null}

        <div className="overflow-x-auto rounded-xl border border-black/8 bg-white shadow-sm">
          {recipients.length === 0 ? (
            <div className="p-6 text-center text-xs text-[var(--text-muted)]">
              {campaign.recipient_type === "manual" ? (
                <>
                  No recipients yet.{" "}
                  <Link href="/dashboard/crm" className="underline">
                    Add some from Contacts
                  </Link>
                  .
                </>
              ) : (
                <>No signups have qualified for this window yet.</>
              )}
            </div>
          ) : (
            <table className="min-w-full text-xs">
              <thead className="bg-[var(--surface)] text-[var(--text-secondary)]">
                <tr>
                  <th className="w-8 px-2 py-2 text-left">
                    <input
                      type="checkbox"
                      checked={recipients.every((r) => selected.has(r.send_id))}
                      onChange={() => {
                        if (recipients.every((r) => selected.has(r.send_id))) {
                          setSelected(new Set());
                        } else {
                          setSelected(new Set(recipients.map((r) => r.send_id)));
                        }
                      }}
                      aria-label="Select all recipients"
                    />
                  </th>
                  <th className="px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">
                    Contact
                  </th>
                  <th className="px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">
                    Sent
                  </th>
                  <th className="w-24 px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sortedRecipients.map((r) => (
                  <tr key={r.send_id} className="border-t border-black/5 hover:bg-[var(--surface)]/40">
                    <td className="px-2 py-2 align-top">
                      <input
                        type="checkbox"
                        checked={selected.has(r.send_id)}
                        onChange={() => {
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(r.send_id)) next.delete(r.send_id);
                            else next.add(r.send_id);
                            return next;
                          });
                        }}
                        aria-label={`Select ${r.email}`}
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <div className="font-medium text-[var(--text-primary)]">
                        {nameOf(r)}
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)]">{r.email}</div>
                    </td>
                    <td className="px-2 py-2 align-top">
                      <button
                        type="button"
                        onClick={() => toggleSent(r.send_id, r.sent_at)}
                        className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                          r.sent_at
                            ? "bg-green-100 text-green-800 hover:bg-green-200"
                            : "border border-black/10 bg-white hover:bg-[var(--surface)]"
                        }`}
                      >
                        {r.sent_at ? `Sent · ${formatDateTime(r.sent_at)}` : "Mark sent"}
                      </button>
                    </td>
                    <td className="px-2 py-2 align-top text-right">
                      {campaign.recipient_type === "manual" ? (
                        <button
                          type="button"
                          onClick={() => removeRecipient(r.send_id)}
                          className="text-[11px] text-[var(--text-muted)] hover:text-[var(--accent)] hover:underline"
                        >
                          Remove
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <div className="text-[10px] text-[var(--text-muted)]">
        Created {new Date(campaign.created_at).toISOString().slice(0, 10)}
        {campaign.completed_at ? ` · completed ${new Date(campaign.completed_at).toISOString().slice(0, 10)}` : ""}
      </div>
    </div>
  );
}
