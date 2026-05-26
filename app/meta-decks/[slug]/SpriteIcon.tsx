"use client";

import { useState } from "react";

interface Props {
  src: string;
  className?: string;
}

/**
 * Limitless sprite icon that hides itself if the source 404s. The
 * onError handler must live in a Client Component — passing it from a
 * Server Component (e.g. MetaVariantCard) throws "Event handlers cannot
 * be passed to Client Component props" during RSC serialization.
 */
export default function SpriteIcon({ src, className }: Props) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
