"use client";

import { useState } from "react";
import Link from "next/link";
import { cardImageSmall } from "@/lib/cardImages";
import type { ListSummary } from "@/lib/lists";

/**
 * A 2x2 mosaic + name/count preview of a list. Shared by the Lists overview
 * panel (`ListsView`) and the profile page's Lists section — same card,
 * same data shape (`ListSummary`), different fetch source.
 */
export default function ListPreviewCard({ list }: { list: ListSummary }) {
  const body = (
    <>
      <div className="grid grid-cols-2 gap-0.5 rounded-lg overflow-hidden bg-surface aspect-square">
        {list.previewCards.length === 0 ? (
          <div className="col-span-2 row-span-2 flex items-center justify-center text-text-muted">
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="w-8 h-8 opacity-40"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h12M4 10h12M4 15h8" />
            </svg>
          </div>
        ) : (
          Array.from({ length: 4 }).map((_, i) => {
            const card = list.previewCards[i];
            return card ? (
              <MosaicThumb key={`${card.setId}-${card.number}`} setId={card.setId} number={card.number} />
            ) : (
              <div key={i} className="bg-surface" />
            );
          })
        )}
      </div>
      <div className="mt-2 flex items-start justify-between gap-2">
        <span className="text-sm font-semibold text-text-primary truncate">{list.name}</span>
        {!list.isPublic && (
          <svg
            aria-label="Private"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="w-3.5 h-3.5 mt-0.5 shrink-0 text-text-muted"
          >
            <rect x="4" y="9" width="12" height="8" rx="1.5" />
            <path strokeLinecap="round" d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9" />
          </svg>
        )}
      </div>
      <span className="text-xs text-text-secondary">
        {list.itemCount} {list.itemCount === 1 ? "card" : "cards"}
      </span>
    </>
  );

  if (!list.href) {
    return (
      <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white dark:bg-surface-elevated p-3 opacity-60">
        {body}
      </div>
    );
  }

  return (
    <Link
      href={list.href}
      className="block rounded-2xl border border-black/8 dark:border-white/10 bg-white dark:bg-surface-elevated p-3 hover:bg-surface/70 transition-colors"
    >
      {body}
    </Link>
  );
}

function MosaicThumb({ setId, number }: { setId: string; number: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <div className="bg-surface" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={cardImageSmall(setId, number)}
      alt=""
      className="w-full h-full object-cover"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
