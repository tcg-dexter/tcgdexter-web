/**
 * Format a meta-deck variant's `date` field for display.
 *
 * The upstream scraper used to emit a combined string like
 *   "16th May 2026 - Regional Campinas"
 * and switched to raw ISO timestamps:
 *   "2026-05-24T00:30:00.000Z"
 *
 * Both shapes are normalized to "May 24, 2026" so the UI presents a
 * single date format everywhere. Callers that need to surface the
 * event name should split the legacy string on " - " before passing
 * the date portion through here.
 */
export function formatMetaVariantDate(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  // Legacy "6th June 2026" — strip the ordinal suffix so Date() parses it.
  const stripped = value.replace(/(\d+)(st|nd|rd|th)/i, "$1");
  const d = new Date(stripped);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
