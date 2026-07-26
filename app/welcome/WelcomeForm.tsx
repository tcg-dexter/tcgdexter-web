"use client";

import { useState } from "react";
import {
  validateUsername,
  slugifyToUsername,
  USERNAME_MAX,
} from "@/lib/username-rules";
import { hasStashedDeckList } from "@/lib/home-restore";

/**
 * Onboarding form: username (required, set-once) + display name (optional).
 * Persists via PATCH /api/profile (same validation the settings editors use).
 * On success, sends the user back to the home page if they have a deck stashed
 * from the "save a deck" funnel (so they can finish that save), otherwise to
 * their new profile.
 */
export default function WelcomeForm({
  initialDisplayName,
}: {
  initialDisplayName: string;
}) {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [username, setUsername] = useState(
    slugifyToUsername(initialDisplayName),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    const uname = username.trim().toLowerCase();
    const check = validateUsername(uname);
    if (!check.valid) {
      setError(check.error);
      return;
    }

    setBusy(true);
    setError(null);

    const body: { username: string; display_name?: string } = { username: uname };
    const dn = displayName.trim();
    if (dn) body.display_name = dn;

    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setBusy(false);
        return;
      }
      // Full navigation (not router.push) so the destination renders fresh
      // with the just-created profile. If a deck is waiting from the save
      // funnel, return home to finish it; otherwise go to the profile.
      window.location.href = hasStashedDeckList()
        ? "/"
        : `/u/${data.username ?? uname}`;
    } catch {
      setError("Network error. Please try again.");
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm p-5 sm:p-6 space-y-5"
    >
      {/* Username — required */}
      <div>
        <label
          htmlFor="welcome-username"
          className="block text-[11px] font-semibold uppercase tracking-widest text-text-muted"
        >
          Username <span className="text-accent">*</span>
        </label>
        <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-border bg-bg px-2.5 focus-within:border-accent/40 focus-within:ring-1 focus-within:ring-accent/20">
          <span className="text-sm text-text-muted">@</span>
          <input
            id="welcome-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            maxLength={USERNAME_MAX}
            disabled={busy}
            autoFocus
            autoComplete="off"
            placeholder="yourname"
            className="flex-1 min-w-0 bg-transparent py-2 text-sm font-mono text-text-primary placeholder:text-text-muted focus:outline-none [font-size:16px] sm:text-sm"
          />
        </div>
        <p className="mt-1 text-xs text-text-muted">
          Your URL handle (tcgdexter.com/u/yourname). Lowercase letters, numbers,
          hyphens. 3&ndash;{USERNAME_MAX} characters. Set once &mdash; can&rsquo;t be changed.
        </p>
      </div>

      {/* Display name — optional */}
      <div>
        <label
          htmlFor="welcome-display-name"
          className="block text-[11px] font-semibold uppercase tracking-widest text-text-muted"
        >
          Display name <span className="font-normal text-text-muted">(optional)</span>
        </label>
        <input
          id="welcome-display-name"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={30}
          disabled={busy}
          autoComplete="off"
          placeholder="How your name shows up"
          className="mt-1.5 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 [font-size:16px] sm:text-sm"
        />
        <p className="mt-1 text-xs text-text-muted">
          You can change this later in Settings.
        </p>
      </div>

      {error && <p className="text-xs text-accent">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="w-full inline-flex items-center justify-center rounded-full bg-gradient-brand px-4 py-2.5 text-sm font-semibold text-white shadow-brand hover:shadow-brand-lg transition disabled:opacity-50"
      >
        {busy ? "Setting up…" : "Continue"}
      </button>
    </form>
  );
}
