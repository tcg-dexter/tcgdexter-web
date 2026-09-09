"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  /** Current lifecycle status — the bar renders a different message for
   *  in_review (approve) than for approved (confirmation). */
  status: "in_review" | "approved";
}

/**
 * Shown to the featured trainer — and only to them — on their own
 * unpublished spotlight.
 *
 * This is the mechanism behind the prep document's promise that the trainer
 * "will get the chance to approve any edits made": once the admin has done
 * the editorial pass and moved the spotlight to in_review, the trainer sees
 * the real page, exactly as it will publish, with an Approve control and an
 * optional note. Approving does not publish — the admin still presses
 * Publish.
 */
export default function SpotlightApprovalBar({ status }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onApprove() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/spotlight/onboarding/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not approve");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not approve");
      setSaving(false);
    }
  }

  if (status === "approved") {
    return (
      <div className="rounded-xl border border-black/10 bg-white/95 px-4 py-3 shadow-sm dark:border-white/10 dark:bg-surface-elevated">
        <p className="text-sm font-semibold text-text-primary">
          Approved — thank you!
        </p>
        <p className="mt-0.5 text-xs text-text-secondary">
          Your spotlight is queued up. It&rsquo;ll appear publicly once it goes
          live.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-black/10 bg-white/95 px-4 py-3 shadow-sm dark:border-white/10 dark:bg-surface-elevated">
      <p className="text-sm font-semibold text-text-primary">
        Ready for your approval
      </p>
      <p className="mt-0.5 text-xs text-text-secondary">
        This is your spotlight as it will publish, with light editing applied.
        Give it a read — if it reads right to you, approve it. If something is
        off, leave a note and it&rsquo;ll come back for another pass.
      </p>
      {open && (
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Anything you'd like changed? (optional)"
          className="mt-3 w-full rounded-md border border-black/15 bg-bg px-3 py-2 [font-size:16px] sm:text-sm resize-none dark:border-white/10"
        />
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onApprove}
          disabled={saving}
          className="text-xs font-semibold px-3 py-1.5 rounded-full gradient-brand shadow-sm hover:opacity-95 disabled:opacity-50"
        >
          {saving ? "Approving…" : "Approve"}
        </button>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-xs font-semibold px-3 py-1.5 rounded-full border border-black/15 text-text-primary hover:bg-[var(--surface)] dark:border-white/10"
          >
            Leave a note
          </button>
        )}
        {error && <span className="text-xs text-accent">{error}</span>}
      </div>
    </div>
  );
}
