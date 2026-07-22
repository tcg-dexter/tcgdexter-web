"use client";

import { useState } from "react";

interface Props {
  initialIsPublic: boolean;
  hasDisplayName: boolean;
}

/**
 * Profile public/private toggle. PATCHes /api/profile with is_public.
 *
 * A display name is required before going public — the server doesn't
 * enforce that, but a missing handle would leave the public profile
 * URL useless, so we gate it client-side with a clear message.
 */
export default function EditPublicToggle({
  initialIsPublic,
  hasDisplayName,
}: Props) {
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle() {
    if (busy) return;
    if (!isPublic && !hasDisplayName) {
      setError("Set a display name before making your profile public.");
      return;
    }
    const next = !isPublic;
    setBusy(true);
    setError(null);
    // Optimistic
    setIsPublic(next);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_public: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setIsPublic(!next);
        setError(data.error ?? "Failed to update.");
      }
    } catch {
      setIsPublic(!next);
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
            Public Profile
          </p>
          <p className="mt-0.5 text-sm text-text-primary">
            {isPublic ? "On — visible to anyone." : "Off — only you can see your profile."}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Your decks must also be set to public individually before they appear on your profile.
          </p>
          {error && <p className="mt-1 text-xs text-accent">{error}</p>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={isPublic}
          onClick={handleToggle}
          disabled={busy}
          className={`flex-shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
            isPublic ? "bg-accent" : "bg-black/20 dark:bg-white/20"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              isPublic ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
    </div>
  );
}
