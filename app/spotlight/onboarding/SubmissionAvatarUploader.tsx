"use client";

import { useRef, useState } from "react";

interface Props {
  initialUrl: string | null;
  /** Lifts the stored URL back to the form so a later save round-trips it. */
  onChange: (url: string | null) => void;
}

const ENDPOINT = "/api/spotlight/onboarding/avatar";

/**
 * The trainer's raw TCG Live screenshot upload.
 *
 * Uploads immediately on pick rather than waiting for the form's Save — the
 * file is large and the route stores it independently of the rest of the
 * submission. Mirrors AvatarImageUploader in the admin editor, but posts to
 * the participant endpoint and never touches the published banner image.
 */
export default function SubmissionAvatarUploader({
  initialUrl,
  onChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so picking the same file twice still fires
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(ENDPOINT, { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      setUrl(json.avatar_upload_url);
      onChange(json.avatar_upload_url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function onClear() {
    if (!confirm("Remove this screenshot?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(ENDPOINT, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Remove failed");
      }
      setUrl(null);
      onChange(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {url && (
        // eslint-disable-next-line @next/next/no-img-element -- Supabase
        // storage URL with a cache-busting query string; no loader benefit.
        <img
          src={url}
          alt="Your uploaded TCG Live avatar screenshot"
          className="max-h-56 rounded-lg border border-black/10 dark:border-white/10"
        />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={onPick}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-black/15 text-text-primary hover:bg-[var(--surface)] disabled:opacity-50 dark:border-white/10"
        >
          {busy ? "Uploading…" : url ? "Replace screenshot" : "Upload screenshot"}
        </button>
        {url && !busy && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs font-semibold text-text-muted hover:text-accent"
          >
            Remove
          </button>
        )}
        {error && <span className="text-xs text-accent">{error}</span>}
      </div>
      <p className="text-xs text-text-muted">PNG, JPEG, or WebP, up to 8 MB.</p>
    </div>
  );
}
