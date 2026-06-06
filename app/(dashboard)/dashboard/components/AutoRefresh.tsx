"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Polls `router.refresh()` on an interval so the dashboard's server-component
 * tree re-fetches without a full page reload. The page-level `revalidate` is
 * set low enough that each refresh actually pulls new data.
 *
 * Renders a tiny "live · 12s ago" indicator so the user can confirm the timer
 * is firing. Pauses when the tab is hidden — no point burning quota for an
 * invisible page.
 */
export default function AutoRefresh({
  intervalMs = 60_000,
}: {
  intervalMs?: number;
}) {
  const router = useRouter();
  const [lastTickAt, setLastTickAt] = useState<number>(() => Date.now());
  const [now, setNow] = useState<number>(() => Date.now());

  // Polling loop — fires the server-component refresh.
  useEffect(() => {
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      router.refresh();
      setLastTickAt(Date.now());
    };
    const id = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(id);
  }, [router, intervalMs]);

  // 1Hz clock — updates the "Ns ago" label without re-rendering the world.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  const secs = Math.max(0, Math.floor((now - lastTickAt) / 1000));
  const label =
    secs < 5
      ? "just now"
      : secs < 60
        ? `${secs}s ago`
        : `${Math.floor(secs / 60)}m ago`;

  return (
    <button
      type="button"
      onClick={() => {
        router.refresh();
        setLastTickAt(Date.now());
      }}
      title="Click to refresh now"
      className="group inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white px-2.5 py-1 text-[11px] text-[var(--text-secondary)] shadow-sm transition hover:border-black/25"
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60"></span>
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
      </span>
      <span className="font-medium uppercase tracking-wider text-[10px]">live</span>
      <span className="text-[var(--text-muted)] tabular-nums">· {label}</span>
    </button>
  );
}
