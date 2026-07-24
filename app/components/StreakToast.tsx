"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import StreakFlame from "./StreakFlame";
import type { StreakState } from "@/lib/streak";

/**
 * The single log-time streak celebration, mounted once in the root layout.
 * Listens for the `dx:streak` window event fired by `celebrateStreak()`
 * after any match log/import succeeds, and shows a brief bottom-center
 * toast. Portaled to <body>; auto-dismisses. This decoupling means the
 * ~5 match-logging call sites only need to fire the event, not own UI.
 */
export default function StreakToast() {
  const [streak, setStreak] = useState<StreakState | null>(null);
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    function onStreak(e: Event) {
      const detail = (e as CustomEvent).detail as StreakState | null;
      if (!detail || detail.current <= 0) return;
      setStreak(detail);
      setVisible(true);
    }
    window.addEventListener("dx:streak", onStreak as EventListener);
    return () => window.removeEventListener("dx:streak", onStreak as EventListener);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setVisible(false), 3600);
    return () => clearTimeout(t);
  }, [visible, streak]);

  if (!mounted || !streak) return null;

  const headline = !streak.changed
    ? "Logged — streak still going"
    : streak.current === 1
      ? "Streak started!"
      : `${streak.current}-day streak!`;

  const isNewBest =
    streak.changed && streak.current > 1 && streak.current === streak.longest;
  const sub = isNewBest
    ? "Your best ever — keep it alive tomorrow."
    : "Come back tomorrow to keep it alive.";

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4 pointer-events-none transition-all duration-300 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
      }`}
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-black/8 dark:border-white/10 bg-white/95 dark:bg-surface-elevated backdrop-blur-xl shadow-lg px-4 py-2.5">
        <StreakFlame count={streak.current} size="lg" showCount={false} />
        <div className="pr-1">
          <div className="text-sm font-bold text-text-primary leading-tight">
            {headline}
          </div>
          <div className="text-xs text-text-muted leading-tight">{sub}</div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
