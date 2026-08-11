"use client";

import { useEffect, useMemo, useRef, useState } from "react";

interface Props {
  src: string;
  /**
   * Further URLs to try if `src` fails, best first — see
   * `cardImageCandidates`. Some sets are split across two CDNs, so a 404 on
   * the primary host doesn't mean we have no image for the card.
   */
  fallbackSrcs?: string[];
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
 * Card image with built-in fallbacks. On error we try each remaining source in
 * turn, and only once they're all exhausted (e.g. a brand-new set no CDN has
 * indexed yet) render a neutral placeholder that still surfaces the card
 * identity, so the grid doesn't look broken.
 *
 * Once the image finishes decoding it fades in — a very subtle entrance
 * that smooths the otherwise jarring "pop" of a card grid filling in.
 */
export default function CardImage({
  src,
  fallbackSrcs,
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
  const STAGGER_MS = 15;
  const delayMs = index != null ? index * STAGGER_MS : 0;
  // Callers build `fallbackSrcs` inline, so it's a fresh array on every render.
  // Key the memo and the reset effect on the joined URLs instead of the array
  // identity, or the effect below would refire forever.
  const sourceKey = [src, ...(fallbackSrcs ?? [])].join("\n");
  const sources = useMemo(() => sourceKey.split("\n"), [sourceKey]);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Reset when the card changes — a recycled element would otherwise keep the
  // previous card's exhausted-sources state and render a false placeholder.
  useEffect(() => {
    setSourceIndex(0);
    setLoaded(false);
  }, [sourceKey]);

  // Cached images may already be complete by the time we mount, in which
  // case the onLoad listener will never fire — surface that as "loaded"
  // so they appear in place without animating from invisible.
  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth > 0) setLoaded(true);
  }, []);

  const failed = sourceIndex >= sources.length;
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
      // Keyed by source so switching hosts remounts the element; React would
      // otherwise reuse it and the browser may not re-request after an error.
      key={sources[sourceIndex]}
      src={sources[sourceIndex]}
      alt={alt}
      loading={loading}
      decoding={decoding}
      fetchPriority={fetchPriority}
      className={className}
      style={{
        ...style,
        opacity: loaded ? 1 : 0,
        transition: "opacity 300ms ease-out",
        transitionDelay: loaded ? `${delayMs}ms` : "0ms",
      }}
      onLoad={() => setLoaded(true)}
      onError={() => setSourceIndex((i) => i + 1)}
    />
  );
}
