import { createHmac, timingSafeEqual } from "crypto";

/**
 * One-click unsubscribe tokens.
 *
 * A token is `${userId}.${sig}` where sig = HMAC-SHA256(userId) keyed by
 * UNSUBSCRIBE_SECRET, hex-encoded. The user id isn't secret — the HMAC is
 * what makes the link unforgeable, so an attacker can't unsubscribe
 * someone else. Verified in the unauthenticated /api/email/unsubscribe
 * route (the recipient has no session when they click from an inbox).
 */

function secret(): string {
  const s = process.env.UNSUBSCRIBE_SECRET;
  if (!s) throw new Error("Missing UNSUBSCRIBE_SECRET");
  return s;
}

function sign(userId: string): string {
  return createHmac("sha256", secret()).update(userId).digest("hex");
}

export function signUnsubToken(userId: string): string {
  return `${userId}.${sign(userId)}`;
}

/** Returns the userId if the token is valid, else null. */
export function verifyUnsubToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);
  let expected: string;
  try {
    expected = sign(userId);
  } catch {
    return null;
  }
  // Length check guards timingSafeEqual (which throws on length mismatch).
  if (providedSig.length !== expected.length) return null;
  const a = Buffer.from(providedSig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || a.length === 0) return null;
  return timingSafeEqual(a, b) ? userId : null;
}
