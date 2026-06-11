"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DEFAULT_BANNER_LAYOUT, INTERACTIVE_BANNER_KEYS } from "../types";

interface Props {
  spotlightId: string;
  slug: string;
  isPublished: boolean;
  /** When true, the Reset button is included. Driven by the spotlight
   *  page when ?preview=1 is set and the user image is present. */
  showDragHint?: boolean;
}

/**
 * Condensed admin pill anchored top-right just below the banner.
 *
 * Layout:
 *   ┌─────────────────────────────────────────┐
 *   │ • Draft  [Reset] [Edit] [Publish]      │
 *   └─────────────────────────────────────────┘
 *
 * Replaces an earlier full-width informational bar — the controls are
 * the same (Reset / Edit / Publish), but the whole module is compact
 * enough to sit alongside the page content rather than above it.
 */
export default function SpotlightAdminBar({
  spotlightId,
  slug,
  isPublished,
  showDragHint,
}: Props) {
  const router = useRouter();
  const [publishing, setPublishing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onReset() {
    setResetting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/spotlight/${spotlightId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          banner_layout: Object.fromEntries(
            INTERACTIVE_BANNER_KEYS.map((k) => [k, DEFAULT_BANNER_LAYOUT[k]]),
          ),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Reset failed");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setResetting(false);
    }
  }

  async function onPublish() {
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/spotlight/${spotlightId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_published: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Publish failed");
      router.push(`/spotlight/${slug}`);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Publish failed");
      setPublishing(false);
    }
  }

  return (
    <div className="flex justify-start">
      <div
        className="inline-flex items-center gap-1.5 rounded-full bg-white/95 backdrop-blur-sm border border-black/10 shadow-sm px-2 py-1.5"
        role="toolbar"
        aria-label="Spotlight admin actions"
      >
        {!isPublished && (
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-accent px-2 py-0.5 rounded-full border border-accent/40 bg-accent/5">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            Draft
          </span>
        )}
        {error && (
          <span
            className="text-[11px] text-accent px-1 truncate max-w-[10rem]"
            title={error}
          >
            {error}
          </span>
        )}
        {showDragHint && (
          <button
            type="button"
            onClick={onReset}
            disabled={resetting}
            className="text-xs font-semibold px-3 py-1 rounded-full border border-black/15 text-text-primary hover:bg-[var(--surface)] disabled:opacity-50"
          >
            {resetting ? "…" : "Reset"}
          </button>
        )}
        <Link
          href={`/admin/spotlight/${spotlightId}/edit`}
          className="text-xs font-semibold px-3 py-1 rounded-full border border-black text-text-primary hover:bg-[var(--surface)]"
        >
          Edit
        </Link>
        {!isPublished && (
          <button
            type="button"
            onClick={onPublish}
            disabled={publishing}
            className="text-xs font-semibold px-3 py-1 rounded-full gradient-brand shadow-sm hover:opacity-95 disabled:opacity-50"
          >
            {publishing ? "Publishing…" : "Publish"}
          </button>
        )}
      </div>
    </div>
  );
}
