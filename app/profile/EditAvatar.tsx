"use client";

import { useRef, useState } from "react";

interface Props {
  initialAvatarUrl: string | null;
  displayName: string;
}

const ACCEPT = "image/png,image/jpeg,image/webp";

/**
 * Avatar upload row. POSTs the file to /api/profile/avatar (multipart)
 * which writes to the public `avatars` storage bucket and updates
 * profiles.avatar_url. The returned URL has a cache-buster so the new
 * image appears immediately.
 */
export default function EditAvatar({ initialAvatarUrl, displayName }: Props) {
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function handlePick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file
    if (!file) return;

    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/profile/avatar", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (res.ok) {
        setAvatarUrl(data.avatar_url);
      } else {
        setError(data.error ?? "Failed to upload avatar.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/avatar", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setAvatarUrl(null);
      } else {
        setError(data.error ?? "Failed to remove avatar.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  const initial = displayName.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="border-b border-black/5 dark:border-white/10 px-4 py-4 bg-white dark:bg-surface-elevated">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-text-muted mb-3">
        Avatar
      </p>
      <div className="flex items-center gap-4">
        <div className="flex-shrink-0">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt="Avatar"
              className="w-16 h-16 rounded-full object-cover border border-black/10 dark:border-white/10"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-surface flex items-center justify-center text-xl font-bold text-text-secondary border border-black/10 dark:border-white/10">
              {initial}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={busy}
              className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-light disabled:opacity-50"
            >
              {busy ? "…" : avatarUrl ? "Change" : "Upload"}
            </button>
            {avatarUrl && (
              <button
                type="button"
                onClick={handleRemove}
                disabled={busy}
                className="rounded-full border border-border bg-bg px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-surface-2 disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </div>
          <p className="mt-1.5 text-xs text-text-muted">
            PNG, JPEG, or WebP — up to 2 MB.
          </p>
          {error && <p className="mt-1 text-xs text-accent">{error}</p>}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={handlePick}
        />
      </div>
    </div>
  );
}
