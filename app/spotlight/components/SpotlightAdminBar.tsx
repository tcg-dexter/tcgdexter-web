"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Props {
  spotlightId: string;
  slug: string;
  isPublished: boolean;
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
}: Props) {
  const router = useRouter();
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        {isPublished
          ? "This spotlight is live."
          : "Visible only to admins. Publish to make it public."}
      </p>
      {error && <span className="text-xs text-accent">{error}</span>}
      <div className="flex items-center gap-2 ml-auto">
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
            className="text-sm font-semibold px-4 py-2 rounded-full text-white bg-gradient-brand border border-transparent shadow-sm hover:opacity-95 disabled:opacity-50"
          >
            {publishing ? "Publishing…" : "Publish"}
          </button>
        )}
      </div>
    </div>
  );
}
