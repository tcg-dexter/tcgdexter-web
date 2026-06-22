import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Fire-and-forget server event tracker. Call from any API route after the
 * meaningful side-effect has occurred:
 *
 *   await track(req, "deck.saved", { is_public: row.is_public });
 *
 * Resolves immediately — the insert is awaited internally and any error is
 * logged and swallowed so analytics can never fail a user request. The
 * `await` only blocks long enough to read auth + cookies, which is already
 * happening on most routes.
 *
 * Identity columns are populated best-effort from the request:
 *   - user_id     — Supabase session (null when anonymous)
 *   - anonymous_id — dx_aid cookie set by lib/supabase/middleware.ts
 *   - session_id   — dx_sid cookie set by lib/supabase/middleware.ts
 *   - locale, user_agent — request headers
 *   - ip_hash      — sha256(ip || daily_salt) when ANALYTICS_IP_SALT is set
 *
 * This generalizes the bespoke capture block at app/api/analyze/route.ts:551.
 */
export async function track(
  req: Request,
  eventName: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  try {
    // Headers + cookies — read synchronously off the request so we never
    // race a downstream consumer of the body.
    const userAgent = req.headers.get("user-agent") ?? null;
    const locale = req.headers.get("accept-language")?.split(",")[0] ?? null;
    const referrer = req.headers.get("referer") ?? null;
    const cookieHeader = req.headers.get("cookie") ?? "";
    const cookieMap = parseCookies(cookieHeader);
    const anonymousId = cookieMap.get("dx_aid") ?? null;
    const sessionId = cookieMap.get("dx_sid") ?? null;

    // Path is best-effort — req.url is absolute on Next route handlers.
    let path: string | null = null;
    try {
      path = new URL(req.url).pathname;
    } catch {
      // ignore
    }

    // ip_hash: only computed when ANALYTICS_IP_SALT is set. Vercel sets
    // x-forwarded-for; we take the first hop. The salt rotates daily so
    // the same IP produces different hashes across days, defeating
    // long-range re-identification while still letting us spot bursts.
    const ipHash = await hashIp(req);

    // user_id — best-effort. createClient() reads the session cookie; if
    // auth isn't set up or the request is anonymous, user is null.
    let userId: string | null = null;
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      userId = user?.id ?? null;
    } catch {
      // Anonymous events are still useful.
    }

    const admin = createAdminClient();
    const { error } = await admin.from("analytics_events").insert({
      event_name: eventName,
      user_id: userId,
      anonymous_id: anonymousId,
      session_id: sessionId,
      properties,
      path,
      referrer,
      locale,
      user_agent: userAgent,
      ip_hash: ipHash,
    });
    if (error) {
      console.error(`[analytics] insert failed (${eventName}):`, error);
    }
  } catch (err) {
    console.error(`[analytics] track threw (${eventName}):`, err);
  }
}

function parseCookies(header: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) out.set(name, decodeURIComponent(value));
  }
  return out;
}

async function hashIp(req: Request): Promise<string | null> {
  const salt = process.env.ANALYTICS_IP_SALT;
  if (!salt) return null;
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd?.split(",")[0]?.trim();
  if (!ip) return null;
  // Rotate the salt daily so today's hash for an IP differs from tomorrow's.
  const day = new Date().toISOString().slice(0, 10);
  const data = new TextEncoder().encode(`${ip}|${salt}|${day}`);
  const buf = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
