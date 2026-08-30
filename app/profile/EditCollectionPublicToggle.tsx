"use client";

import { useState } from "react";

interface Props {
  initialCollectionPublic: boolean;
  /** Whether the profile itself is public. A private profile hides the
   *  collection regardless, so the copy says so rather than letting this
   *  read as "on" while nothing is actually visible. */
  profileIsPublic: boolean;
}

/**
 * Collection public/private toggle. PATCHes /api/profile with
 * collection_public.
 *
 * Separate from the profile's own is_public switch on purpose: what someone
 * owns (and what it's worth) is a different disclosure from which decks
 * they've shared, so making a profile public doesn't opt its collection in.
 * Both have to be on for visitors to see the module — the copy below spells
 * that out when the profile is still private, since otherwise this would
 * read as "on" while nothing is actually visible to anyone.
 */
export default function EditCollectionPublicToggle({
  initialCollectionPublic,
  profileIsPublic,
}: Props) {
  const [collectionPublic, setCollectionPublic] = useState(initialCollectionPublic);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle() {
    if (busy) return;
    const next = !collectionPublic;
    setBusy(true);
    setError(null);
    setCollectionPublic(next);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collection_public: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCollectionPublic(!next);
        setError(data.error ?? "Failed to update.");
      }
    } catch {
      setCollectionPublic(!next);
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
            Public Collection
          </p>
          <p className="mt-0.5 text-sm text-text-primary">
            {collectionPublic
              ? "On — anyone can see your collection stats and value."
              : "Off — only you can see your collection."}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {collectionPublic && !profileIsPublic
              ? "Your profile is private, so this stays hidden until you make the profile public too."
              : "Shows total cards, sets, and collection value on your profile. Your individual cards are never listed."}
          </p>
          {error && <p className="mt-1 text-xs text-accent">{error}</p>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={collectionPublic}
          onClick={handleToggle}
          disabled={busy}
          className={`flex-shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
            collectionPublic ? "bg-accent" : "bg-black/20 dark:bg-white/20"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              collectionPublic ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
    </div>
  );
}
