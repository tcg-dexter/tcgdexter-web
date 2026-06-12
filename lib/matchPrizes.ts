/**
 * Validates a prize-count field from a match log request body. `undefined`
 * or `null` means "not recorded" and passes through as `null`; anything
 * else must be an integer in the 0-6 range a TCG match can produce.
 */
export function parsePrizeCount(
  value: unknown
): { ok: true; value: number | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6) {
    return { ok: true, value };
  }
  return { ok: false };
}
