"use client";

import { useEffect, useRef, useState } from "react";

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
  /**
   * Position in a sibling grid. Drives a small per-card transition
   * delay so the fade-in cascades left-to-right, row-by-row.
   */
  index?: number;
}

/**
 * Card image with a built-in fallback. If the source 404s (e.g. brand-new
 * set not yet indexed by pokemontcg.io), we render a neutral placeholder
 * that still surfaces the card identity, so the grid doesn't look broken.
 *
 * Once the image finishes decoding it fades in and slides down ~6% of its
 * own height — a very subtle entrance that smooths the otherwise jarring
 * "pop" of a card grid filling in.
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
  index,
}: Props) {
  const STAGGER_MS = 20;
  const delayMs = index != null ? index * STAGGER_MS : 0;
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Cached images may already be complete by the time we mount, in which
  // case the onLoad listener will never fire — surface that as "loaded"
  // so they appear in place without animating from invisible.
  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth > 0) setLoaded(true);
  }, []);

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
      ref={imgRef}
      src={src}
      alt={alt}
      loading={loading}
      decoding={decoding}
      fetchPriority={fetchPriority}
      className={className}
      style={{
        ...style,
        opacity: loaded ? 1 : 0,
        transform: loaded ? "translateY(0)" : "translateY(-6%)",
        transition: "opacity 400ms ease-out, transform 400ms ease-out",
        transitionDelay: loaded ? `${delayMs}ms` : "0ms",
      }}
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
    />
  );
}
