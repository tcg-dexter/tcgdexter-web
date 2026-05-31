"use client";

import { useState } from "react";

interface Props {
  src: string;
  alt: string;
  name: string;
  setName: string;
  number: string;
  className?: string;
  style?: React.CSSProperties;
  loading?: "lazy" | "eager";
  decoding?: "async" | "sync" | "auto";
  fetchPriority?: "high" | "low" | "auto";
}

/**
 * Card image with a built-in fallback. If the source 404s (e.g. brand-new
 * set not yet indexed by pokemontcg.io), we render a neutral placeholder
 * that still surfaces the card identity, so the grid doesn't look broken.
 */
export default function CardImage({
  src,
  alt,
  name,
  setName,
  number,
  className,
  style,
  loading = "lazy",
  decoding = "async",
  fetchPriority = "low",
}: Props) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className={`${className ?? ""} flex flex-col items-center justify-center text-center p-3 bg-gradient-to-br from-surface to-surface-2 text-text-secondary`}
        style={style}
        role="img"
        aria-label={alt}
      >
        <div className="text-[10px] uppercase tracking-wider opacity-60 mb-1">No image</div>
        <div className="text-sm font-semibold text-text-primary leading-tight line-clamp-3">
          {name}
        </div>
        <div className="mt-2 text-[11px] opacity-70 leading-tight">
          {setName} · {number}
        </div>
      </div>
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt={alt}
      loading={loading}
      decoding={decoding}
      fetchPriority={fetchPriority}
      className={className}
      style={style}
      onError={() => setFailed(true)}
    />
  );
}
