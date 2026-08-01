"use client";

import { useTheme } from "@/app/components/ThemeProvider";
import ThemeColor from "@/app/components/ThemeColor";

// Mirrors the --bg design token in both themes (app/globals.css). Unlike
// the product-facing pages (deck profile, spotlight, meta archetype),
// the dashboard has no banner/gradient to derive a color from — it's a
// flat page background — so the mobile browser chrome (the "site menu
// bar" at the very top of the viewport) just tracks --bg directly.
// Reactive to in-session theme toggles via useTheme(), unlike the other
// pages' ThemeColor calls which pass a static per-page accent.
const BG_LIGHT = "#f2f2f2";
const BG_DARK = "#242424";

export default function DashboardThemeColor() {
  const { resolvedTheme } = useTheme();
  return <ThemeColor color={resolvedTheme === "dark" ? BG_DARK : BG_LIGHT} />;
}
