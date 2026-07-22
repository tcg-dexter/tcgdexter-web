"use client";

import { useState } from "react";
import { validateDisplayName } from "@/lib/display-name-rules";

interface Props {
  initialName: string;
  joinedDate: string;
}

/**
 * Top row of the combined profile card: renders Display Name + Joined
 * side-by-side in a 2-column grid. When the user clicks Edit, the
 * Joined column is hidden so the input has the full row width.
 *
 * Calls PATCH /api/profile on save.
 */
export default function EditDisplayName({ initialName, joinedDate }: Props) {
  const [name, setName] = useState(initialName);
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const trimmed = input.trim();
    if (trimmed === name) {
      setEditing(false);
      return;
    }
    // Client-side validation (same rules as server — fast feedback)
    const check = validateDisplayName(trimmed);
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
        body: JSON.stringify({ display_name: trimmed }),
      });
      const data = await res.json();
      if (res.ok) {
        setName(data.display_name);
        setEditing(false);
      } else {
        setError(data.error ?? "Failed to update.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  function handleCancel() {
    setInput(name);
    setEditing(false);
    setError(null);
  }

  return (
    <div className={`border-b border-black/5 dark:border-white/10 ${editing ? "" : "grid grid-cols-2"}`}>
      {/* Display name cell — spans full row when editing */}
      <div className="px-4 py-3 bg-white dark:bg-surface-elevated">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-text-muted">
          Display name
        </p>

        {editing ? (
          <div className="mt-1 flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={16}
              disabled={busy}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") handleCancel();
              }}
              className="flex-1 min-w-0 rounded-md border border-border bg-bg px-2 py-1 text-sm text-text-primary focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 [font-size:16px] sm:text-sm"
            />
            <button
              onClick={handleSave}
              disabled={busy}
              className="text-xs font-semibold text-accent hover:text-accent-light disabled:opacity-50"
            >
              {busy ? "..." : "Save"}
            </button>
            <button
              onClick={handleCancel}
              disabled={busy}
              className="text-xs font-semibold text-text-muted hover:text-text-secondary disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="mt-0.5 flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-text-primary truncate">
              {name}
            </span>
            <button
              onClick={() => {
                setInput(name);
                setEditing(true);
                setError(null);
              }}
              className="flex-shrink-0 text-xs font-semibold text-accent hover:text-accent-light"
            >
              Edit
            </button>
          </div>
        )}

        {error && (
          <p className="mt-1 text-xs text-accent">{error}</p>
        )}
      </div>

      {/* Joined cell — hidden while editing so the input has full width */}
      {!editing && (
        <div className="px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-text-muted">
            Joined
          </p>
          <p className="mt-0.5 text-sm font-semibold text-text-primary truncate">
            {joinedDate}
          </p>
        </div>
      )}
    </div>
  );
}
