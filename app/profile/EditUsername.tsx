"use client";

import { useState } from "react";
import {
  validateUsername,
  slugifyToUsername,
  USERNAME_MAX,
} from "@/lib/username-rules";

interface Props {
  initialUsername: string | null;
  /** Used to seed the input with a slugified suggestion when the field is empty. */
  displayNameForSuggestion: string;
}

/**
 * Username row in the profile card.
 *
 * Username is immutable once set — it's the URL handle (/u/[username]) and a
 * rename would break every existing link to the user. UI reflects this:
 *
 * - Unset: shows an inline editor with a suggestion derived from display_name.
 * - Set:   shows the value as @username + a small "permanent" hint, no Edit affordance.
 */
export default function EditUsername({
  initialUsername,
  displayNameForSuggestion,
}: Props) {
  const [username, setUsername] = useState<string | null>(initialUsername);
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState<string>(
    initialUsername ?? slugifyToUsername(displayNameForSuggestion),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const value = input.trim().toLowerCase();
    const check = validateUsername(value);
    if (!check.valid) {
      setError(check.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: value }),
      });
      const data = await res.json();
      if (res.ok) {
        setUsername(data.username ?? value);
        setEditing(false);
      } else {
        setError(data.error ?? "Failed to set username.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  // Already set — render read-only.
  if (username && !editing) {
    return (
      <div className="px-4 py-3 border-b border-black/5 dark:border-white/10">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-text-muted">
          Username
        </p>
        <div className="mt-0.5 flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-text-primary truncate">
            @{username}
          </span>
          <span className="flex-shrink-0 text-[10px] uppercase tracking-wider text-text-muted">
            Permanent
          </span>
        </div>
      </div>
    );
  }

  // Not yet set — show inline editor (initially closed unless the user clicks Set).
  if (!editing) {
    return (
      <div className="px-4 py-3 border-b border-black/5 dark:border-white/10">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-text-muted">
          Username
        </p>
        <div className="mt-0.5 flex items-center gap-2 min-w-0">
          <span className="text-sm text-text-muted truncate">Not set</span>
          <button
            onClick={() => {
              setInput(slugifyToUsername(displayNameForSuggestion));
              setEditing(true);
              setError(null);
            }}
            className="flex-shrink-0 text-xs font-semibold text-accent hover:text-accent-light"
          >
            Set
          </button>
        </div>
        <p className="mt-1 text-xs text-text-muted">
          Your URL handle (e.g. tcgdexter.com/u/yourname). Set once, can&apos;t be changed.
        </p>
      </div>
    );
  }

  // Editing — full input.
  return (
    <div className="px-4 py-3 border-b border-black/5 dark:border-white/10">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-text-muted">
        Username
      </p>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-sm text-text-muted">@</span>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value.toLowerCase())}
          maxLength={USERNAME_MAX}
          disabled={busy}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") setEditing(false);
          }}
          className="flex-1 min-w-0 rounded-md border border-border bg-bg px-2 py-1 text-sm font-mono text-text-primary focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 [font-size:16px] sm:text-sm"
        />
        <button
          onClick={handleSave}
          disabled={busy}
          className="text-xs font-semibold text-accent hover:text-accent-light disabled:opacity-50"
        >
          {busy ? "..." : "Save"}
        </button>
        <button
          onClick={() => {
            setEditing(false);
            setError(null);
          }}
          disabled={busy}
          className="text-xs font-semibold text-text-muted hover:text-text-secondary disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      <p className="mt-1 text-xs text-text-muted">
        Lowercase letters, numbers, hyphens. 3–{USERNAME_MAX} characters. Permanent.
      </p>
      {error && <p className="mt-1 text-xs text-accent">{error}</p>}
    </div>
  );
}
