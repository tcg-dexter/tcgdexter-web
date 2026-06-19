"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewCampaignForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/crm/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, subject, body }),
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
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border border-black/8 bg-white p-4 shadow-sm">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Name <span className="text-[var(--accent)]">*</span>
        </span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="e.g. June 2026 launch"
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

      {error ? <div className="text-[11px] text-[var(--accent)]">{error}</div> : null}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending || !name.trim()}
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
