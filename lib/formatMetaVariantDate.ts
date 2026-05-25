/**
 * Format a meta-deck variant's `date` field for display.
 *
 * The upstream scraper used to emit a combined string like
 *   "16th May 2026 - Regional Campinas"
 * and switched to raw ISO timestamps:
 *   "2026-05-24T00:30:00.000Z"
 *
 * Until the scraper restores a `tournament_name` field, we format ISO
 * strings to "May 24, 2026" so the UI doesn't surface a raw datetime.
 * Legacy human-readable strings pass through unchanged.
 */
export function formatMetaVariantDate(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const isoMatch = /^\d{4}-\d{2}-\d{2}T/.test(value);
  if (!isoMatch) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
