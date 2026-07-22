"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { type Theme, THEME_COOKIE, THEME_COOKIE_MAX_AGE, resolveTheme } from "@/lib/theme";

interface ThemeCtx {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeCtx>({
  theme: "light",
  resolvedTheme: "light",
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function systemPrefersDark() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyClass(resolved: "light" | "dark") {
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

function writeCookie(theme: Theme) {
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
}

/**
 * Real theme state (light/dark/system), seeded from the server-resolved
 * cookie value so hydration matches what app/layout.tsx already rendered.
 * setTheme updates the `dark` class, the dx_theme cookie, and — best
 * effort, ignored if signed out — the account's persisted preference via
 * PATCH /api/profile.
 */
export default function ThemeProvider({
  initialTheme,
  children,
}: {
  initialTheme: Theme;
  children: React.ReactNode;
}) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() =>
    resolveTheme(initialTheme, systemPrefersDark())
  );

  // Keep resolvedTheme (and the `dark` class) in sync with OS-level
  // changes while theme === "system".
  useEffect(() => {
    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    function onChange() {
      const next = mql.matches ? "dark" : "light";
      setResolvedTheme(next);
      applyClass(next);
    }
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    const nextResolved = resolveTheme(next, systemPrefersDark());
    setResolvedTheme(nextResolved);
    applyClass(nextResolved);
    writeCookie(next);
    // Fire-and-forget: persists for signed-in users, 401s silently
    // (ignored) for signed-out visitors — no need to check auth state
    // up front just to decide whether to send this.
    void fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme_preference: next }),
    }).catch(() => {});
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
