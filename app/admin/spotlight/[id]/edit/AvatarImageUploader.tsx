"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  spotlightId: string;
  initialUrl: string | null;
}

/**
 * Upload + preview widget for the spotlight's foreground avatar image
 * (e.g. the trainer's TCG Live avatar). The actual repositioning happens
 * on the preview page; this component only handles the file lifecycle.
 */
export default function AvatarImageUploader({ spotlightId, initialUrl }: Props) {
  const router = useRouter();
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
      const res = await fetch(`/api/admin/spotlight/${spotlightId}/avatar`, {
        method: "POST",
        body: form,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      setUrl(json.avatar_image_url);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function onClear() {
    if (!confirm("Remove this image?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/spotlight/${spotlightId}/avatar`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Clear failed");
      }
      setUrl(null);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Clear failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="w-20 h-20 rounded-2xl bg-[var(--surface)] border border-black/10 overflow-hidden flex items-center justify-center shrink-0">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt="Spotlight avatar"
            className="w-full h-full object-contain"
          />
        ) : (
          <span className="text-[10px] text-text-muted uppercase tracking-wider text-center px-1">
            No image
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-black/15 hover:bg-[var(--surface)] disabled:opacity-50"
          >
            {url ? "Replace…" : "Upload image…"}
          </button>
          {url && (
            <button
              type="button"
              disabled={busy}
              onClick={onClear}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-accent text-accent hover:bg-accent hover:text-white disabled:opacity-50"
            >
              Remove
            </button>
          )}
          {busy && <span className="text-xs text-text-muted">Working…</span>}
        </div>
        <p className="text-xs text-text-muted">
          PNG / JPEG / WebP, 4 MB max. Reposition it on the preview page.
        </p>
        {error && <p className="text-xs text-accent">{error}</p>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={onPick}
        className="hidden"
      />
    </div>
  );
}
