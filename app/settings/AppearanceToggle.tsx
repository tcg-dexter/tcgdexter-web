"use client";

import { useTheme } from "@/app/components/ThemeProvider";
import type { Theme } from "@/lib/theme";

const OPTIONS: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/**
 * Three-way Light/Dark/System control — same sliding-capsule idiom as
 * GridListToggle (the deck-collection/card-catalog view switcher):
 * bg-black/5 dark:bg-white/5 track, a black (dark:white) slider, and
 * text-white dark:text-black on whichever tab is active.
 *
 * Self-contained (no outer padding baked in) so it drops into different
 * contexts — the Settings page card, the mobile nav menu, the desktop
 * sidebar — each of which wraps it with their own spacing.
 */
export default function AppearanceToggle({ className = "" }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const index = OPTIONS.findIndex((o) => o.value === theme);

  return (
    <div
      className={`relative flex items-center h-[38px] rounded-full bg-black/5 dark:bg-white/5 p-[3px] ${className}`}
      role="tablist"
    >
      <div
        aria-hidden
        className="absolute inset-y-[3px] left-[3px] w-[calc(33.333%-3px)] rounded-full bg-black dark:bg-white shadow-sm transition-transform duration-300 ease-in-out"
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={theme === option.value}
          onClick={() => setTheme(option.value)}
          className={`relative z-10 h-full flex-1 flex items-center justify-center rounded-full text-xs font-bold transition-colors ${
            theme === option.value ? "text-white dark:text-black" : "text-text-muted"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
