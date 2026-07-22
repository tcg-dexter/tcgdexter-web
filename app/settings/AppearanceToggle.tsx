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
 * GridListToggle, generalized to three positions. Uses --accent for the
 * active fill (already the codebase's "this is the on state" color, see
 * EditPublicToggle) rather than the black/white capsule convention, since
 * accent doesn't change between themes and this control has to render
 * correctly in both.
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
      className={`relative flex items-center h-[38px] rounded-full bg-bg p-[3px] ${className}`}
      role="tablist"
    >
      <div
        aria-hidden
        className="absolute inset-y-[3px] left-[3px] w-[calc(33.333%-3px)] rounded-full bg-accent shadow-sm transition-transform duration-300 ease-in-out"
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
            theme === option.value ? "text-white" : "text-text-muted"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
