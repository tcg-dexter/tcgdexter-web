/**
 * Shift a 6-digit hex color's RGB channels by a percentage delta of
 * the full 0–255 range. Positive deltas lighten, negative deltas
 * darken. Clamps each channel at the bounds so we never wrap.
 *
 * Used to synthesize gradient endpoints from a single accent color
 * (e.g. meta archetype banner: top = iconBg, bottom = shade(iconBg,
 * -22) for a few shades darker).
 */
export function shade(hex: string, deltaPct: number): string {
  const m = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  const delta = Math.round((255 * deltaPct) / 100);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 0xff) + delta));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + delta));
  const b = Math.max(0, Math.min(255, (num & 0xff) + delta));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
