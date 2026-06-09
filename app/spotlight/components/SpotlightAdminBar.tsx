"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DEFAULT_BANNER_LAYOUT, INTERACTIVE_BANNER_KEYS } from "../types";

interface Props {
  spotlightId: string;
  slug: string;
  isPublished: boolean;
  /** When true, hint the admin that the banner image can be dragged
   *  to reposition. Driven by the spotlight page when ?preview=1 is
   *  set and a banner image is present. */
  showDragHint?: boolean;
}

/**
 * Floating admin action bar shown on the spotlight page for users with
 * profiles.is_admin. While the spotlight is a draft, the bar carries a
 * "Draft preview" pill plus Edit + Publish. After publish, the bar drops
 * the publish action and stays as a quick path back to the editor.
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
          // Only reset the interactive items — the favorite-Pokémon
          // sprite is pinned to the bottom-right corner by CSS and
          // isn't user-positionable. Sending its layout entry would
          // overwrite the schema default with no effect.
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
      // Land on the canonical published URL with no `?preview=1`.
      router.push(`/spotlight/${slug}`);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Publish failed");
      setPublishing(false);
    }
  }

  return (
    <div className="rounded-2xl border border-black/8 bg-white shadow-sm p-4 mb-6 flex flex-wrap items-center gap-3">
      {!isPublished && (
        <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-accent px-3 py-1 rounded-full border border-accent/40 bg-accent/5">
          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
          Draft preview
        </span>
      )}
      <p className="text-xs text-text-secondary flex-1 min-w-0">
        {showDragHint
          ? "Drag the user image to reposition; scroll or drag the handle to resize. Tap Reset to recenter."
          : isPublished
            ? "This spotlight is live."
            : "Visible only to admins. Publish to make it public."}
      </p>
      {error && <span className="text-xs text-accent">{error}</span>}
      <div className="flex items-center gap-2 ml-auto">
        {showDragHint && (
          <button
            type="button"
            onClick={onReset}
            disabled={resetting}
            className="text-sm font-semibold px-4 py-2 rounded-full border border-black/15 text-text-primary hover:bg-[var(--surface)] disabled:opacity-50"
          >
            {resetting ? "Resetting…" : "Reset"}
          </button>
        )}
        <Link
          href={`/admin/spotlight/${spotlightId}/edit`}
          className="text-sm font-semibold px-4 py-2 rounded-full border border-black text-text-primary hover:bg-[var(--surface)]"
        >
          Edit
        </Link>
        {!isPublished && (
          <button
            type="button"
            onClick={onPublish}
            disabled={publishing}
            className="text-sm font-semibold px-4 py-2 rounded-full gradient-brand shadow-sm hover:opacity-95 disabled:opacity-50"
          >
            {publishing ? "Publishing…" : "Publish"}
          </button>
        )}
      </div>
    </div>
  );
}
