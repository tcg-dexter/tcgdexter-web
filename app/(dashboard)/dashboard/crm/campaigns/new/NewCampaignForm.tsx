"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RecipientType } from "../../lib/types";

// Default the signup window to the current calendar month — matches the
// "Welcome | <MMM YY>" pattern of welcoming users who joined this month.
function defaultWindow(): { start: string; end: string } {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

export default function NewCampaignForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipientType, setRecipientType] = useState<RecipientType>("manual");
  const initialWindow = defaultWindow();
  const [windowStart, setWindowStart] = useState(initialWindow.start);
  const [windowEnd, setWindowEnd] = useState(initialWindow.end);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const windowInvalid =
    recipientType === "signup_window" &&
    (!windowStart || !windowEnd || windowEnd < windowStart);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (windowInvalid) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/crm/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          subject,
          body,
          recipient_type: recipientType,
          signup_window_start: recipientType === "signup_window" ? windowStart : null,
          signup_window_end: recipientType === "signup_window" ? windowEnd : null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const j = (await res.json()) as { id: string };
      router.push(`/dashboard/crm/campaigns/${j.id}`);
    } catch (e) {
      setError(String(e));
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Name <span className="text-[var(--accent)]">*</span>
        </span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="e.g. Welcome | JUN 26"
          className="rounded-md border border-black/10 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-black/30"
        />
        <span className="text-[11px] text-[var(--text-muted)]">
          Internal label — never shown to recipients.
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Subject
        </span>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject line of the email you'll send"
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
          placeholder="Draft your email here. Plain text for now; templating + API send come later."
          className="rounded-md border border-black/10 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-black/30 font-mono"
        />
      </label>

      {/* Recipient rule — drives auto-enrollment. Manual is the existing
          behavior; signup_window enrolls every user whose signup date
          falls in the chosen range, and keeps pulling in new ones as
          they qualify. */}
      <fieldset className="flex flex-col gap-2 border-t border-black/10 pt-3">
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
              Auto-enroll every user who signs up in the date range below — new signups keep getting added until the campaign is marked complete.
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

      {error ? <div className="text-[11px] text-[var(--accent)]">{error}</div> : null}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending || !name.trim() || windowInvalid}
          className="rounded-md bg-black px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create campaign"}
        </button>
        <Link
          href="/dashboard/crm/campaigns"
          className="text-xs text-[var(--text-muted)] hover:underline"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
