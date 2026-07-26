"use client";

import { useState } from "react";

interface Props {
  initialEnabled: boolean;
}

/**
 * Re-engagement email opt-in toggle. PATCHes /api/profile with
 * email_reengagement. Mirrors EditPublicToggle: optimistic update with
 * rollback on failure.
 */
export default function EditEmailNotificationsToggle({ initialEnabled }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle() {
    if (busy) return;
    const next = !enabled;
    setBusy(true);
    setError(null);
    setEnabled(next); // optimistic
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email_reengagement: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEnabled(!next);
        setError(data.error ?? "Failed to update.");
      }
    } catch {
      setEnabled(!next);
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 py-3 bg-white dark:bg-surface-elevated">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-text-muted">
            Reminder Emails
          </p>
          <p className="mt-0.5 text-sm text-text-primary">
            {enabled
              ? "On — we'll nudge you when your streak is about to lapse or a badge is within reach."
              : "Off — we won't email you reminders."}
          </p>
          {error && <p className="mt-1 text-xs text-accent">{error}</p>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={handleToggle}
          disabled={busy}
          className={`flex-shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
            enabled ? "bg-accent" : "bg-black/20 dark:bg-white/20"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
    </div>
  );
}
