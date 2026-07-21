export type Theme = "light" | "dark" | "system";

export const THEME_COOKIE = "dx_theme";
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export function parseTheme(value: string | undefined | null): Theme {
  return value === "dark" || value === "system" ? value : "light";
}

export function resolveTheme(theme: Theme, systemPrefersDark: boolean): "light" | "dark" {
  return theme === "system" ? (systemPrefersDark ? "dark" : "light") : theme;
}
