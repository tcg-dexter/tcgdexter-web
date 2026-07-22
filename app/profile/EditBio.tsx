"use client";

import { useState } from "react";

interface Props {
  initialBio: string | null;
}

const MAX = 240;

/**
 * Bio editor row. PATCHes /api/profile with `bio`. Empty string clears
 * the field (server treats trimmed-empty as null).
 */
export default function EditBio({ initialBio }: Props) {
  const [bio, setBio] = useState(initialBio ?? "");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialBio ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const trimmed = draft.trim();
    if (trimmed === bio.trim()) {
      setEditing(false);
      return;
    }
    if (trimmed.length > MAX) {
      setError(`Bio must be ${MAX} characters or fewer.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bio: trimmed.length === 0 ? null : trimmed }),
      });
      const data = await res.json();
      if (res.ok) {
        setBio(typeof data.bio === "string" ? data.bio : "");
        setEditing(false);
      } else {
        setError(data.error ?? "Failed to update bio.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  function handleCancel() {
    setDraft(bio);
    setEditing(false);
    setError(null);
  }

  return (
    <div className="border-b border-black/5 dark:border-white/10 px-4 py-3 bg-white dark:bg-surface-elevated">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-text-muted">
        Bio
      </p>
      {editing ? (
        <div className="mt-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            maxLength={MAX}
            disabled={busy}
            autoFocus
            className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 [font-size:16px] sm:text-sm resize-none"
            placeholder="A short blurb that appears on your public profile."
          />
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-xs text-text-muted">
              {draft.length} / {MAX}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={busy}
                className="text-xs font-semibold text-accent hover:text-accent-light disabled:opacity-50"
              >
                {busy ? "…" : "Save"}
              </button>
              <button
                onClick={handleCancel}
                disabled={busy}
                className="text-xs font-semibold text-text-muted hover:text-text-secondary disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
          {error && <p className="mt-1 text-xs text-accent">{error}</p>}
        </div>
      ) : (
        <div className="mt-0.5 flex items-start gap-2">
          <p className="flex-1 text-sm text-text-primary whitespace-pre-wrap break-words min-w-0">
            {bio.trim() || (
              <span className="text-text-muted italic">No bio yet.</span>
            )}
          </p>
          <button
            onClick={() => {
              setDraft(bio);
              setEditing(true);
              setError(null);
            }}
            className="flex-shrink-0 text-xs font-semibold text-accent hover:text-accent-light"
          >
            Edit
          </button>
        </div>
      )}
    </div>
  );
}
