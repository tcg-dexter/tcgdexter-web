import { BLOCKED_SET } from "./display-name-rules";

/**
 * Username rules — the immutable URL handle for a profile.
 *
 * Distinct from display_name (which is mutable presentation): username is
 * always lowercase, slug-safe, unique, and set once. It's what powers
 * /u/[username] URLs, so it must be stable for the life of the profile.
 *
 * Format:
 *   - 3–20 chars
 *   - [a-z0-9-] only
 *   - no leading/trailing '-'
 *   - no consecutive '--'
 *   - not on the blocklist (case-insensitive)
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

const VALID_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const DOUBLE_DASH = /--/;

export interface ValidationResult {
  valid: boolean;
  error: string | null;
}

/** Validate a candidate username. Does NOT check uniqueness — that's a DB query. */
export function validateUsername(raw: string): ValidationResult {
  const value = raw.trim().toLowerCase();
  if (value.length < USERNAME_MIN) {
    return { valid: false, error: `Username must be at least ${USERNAME_MIN} characters.` };
  }
  if (value.length > USERNAME_MAX) {
    return { valid: false, error: `Username must be ${USERNAME_MAX} characters or fewer.` };
  }
  if (!VALID_RE.test(value)) {
    return {
      valid: false,
      error: "Username may contain only lowercase letters, numbers, and hyphens (no leading or trailing hyphen).",
    };
  }
  if (DOUBLE_DASH.test(value)) {
    return { valid: false, error: "Username cannot contain consecutive hyphens." };
  }
  if (BLOCKED_SET.has(value)) {
    return { valid: false, error: "That username isn't available." };
  }
  return { valid: true, error: null };
}

/**
 * Best-effort slug derived from any string (e.g. a display_name). The output
 * is a *candidate* — the caller must still pass it through validateUsername
 * and then check DB uniqueness. Used by the /welcome onboarding form to
 * suggest a default when a user picks their handle.
 */
export function slugifyToUsername(input: string): string {
  let slug = input.toLowerCase();
  slug = slug.replace(/[^a-z0-9]+/g, "-");
  slug = slug.replace(/^-+|-+$/g, "");
  if (slug.length === 0) return "";
  if (slug.length > USERNAME_MAX) slug = slug.slice(0, USERNAME_MAX);
  slug = slug.replace(/-+/g, "-");
  slug = slug.replace(/^-+|-+$/g, "");
  return slug;
}
