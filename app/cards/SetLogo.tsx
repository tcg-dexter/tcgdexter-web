"use client";

import { useState } from "react";

interface Props {
  src: string | null;
  ptcgoCode: string | null;
  setName: string;
  /** Sizing + positioning classes; the component owns flex centering and
   *  contains the image with `object-contain`. */
  className?: string;
}

/**
 * Set logo with a graceful PTCGO-badge fallback. Falls back when:
 *  - `src` is null (no known image — e.g. sets not on pokemontcg.io's CDN)
 *  - the image fails to load at runtime (set freshly added, brand image
 *    not yet uploaded upstream)
 */
export default function SetLogo({ src, ptcgoCode, setName, className }: Props) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`${className ?? ""} flex items-center justify-center rounded-md border border-black/10 bg-surface text-[10px] font-bold tracking-wide text-text-secondary uppercase`}
        title={setName}
        aria-label={setName}
      >
        {ptcgoCode ?? "—"}
      </div>
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt={`${setName} logo`}
      loading="lazy"
      decoding="async"
      className={`${className ?? ""} object-contain`}
      onError={() => setFailed(true)}
    />
  );
}
