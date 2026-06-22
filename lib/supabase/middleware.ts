import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Analytics identity cookies. dx_aid is a stable per-browser id used to
// stitch pre- and post-signup behavior; dx_sid is a sliding 30-min session
// id used to count sessions and split first-session from returning-session
// events. Both are read by lib/analytics/track.ts on server-side events.
const AID_COOKIE = "dx_aid";
const SID_COOKIE = "dx_sid";
const AID_MAX_AGE = 60 * 60 * 24 * 365 * 2; // 2 years
const SID_MAX_AGE = 60 * 30; // 30 minutes (sliding via re-set on every req)

function newId(): string {
  // 16 bytes of crypto-random hex. globalThis.crypto is available in the
  // Next.js edge runtime where middleware runs.
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function setAnalyticsCookies(request: NextRequest, response: NextResponse) {
  const existingAid = request.cookies.get(AID_COOKIE)?.value;
  const existingSid = request.cookies.get(SID_COOKIE)?.value;

  const aid = existingAid && /^[0-9a-f]{32}$/.test(existingAid) ? existingAid : newId();
  // Always re-set sid to slide the 30-min expiry forward on every request.
  // If the previous sid is still valid (cookie present), reuse it; otherwise
  // mint a new one so a fresh session starts after 30 min of inactivity.
  const sid = existingSid && /^[0-9a-f]{32}$/.test(existingSid) ? existingSid : newId();

  const common = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };

  if (aid !== existingAid) {
    response.cookies.set(AID_COOKIE, aid, { ...common, maxAge: AID_MAX_AGE });
  }
  // Re-set sid every request to slide the expiry — cost is one Set-Cookie
  // header per request, which is negligible.
  response.cookies.set(SID_COOKIE, sid, { ...common, maxAge: SID_MAX_AGE });
}

/**
 * Called from the root middleware.ts on every request.
 * Refreshes the Supabase session cookie if it's close to expiring,
 * so signed-in users stay signed in without needing to re-auth.
 *
 * Also sets the analytics identity cookies (dx_aid, dx_sid) used by
 * server-side track() calls.
 *
 * This does NOT gate any routes — it only keeps sessions fresh.
 * Route protection happens in individual server components via redirect().
 *
 * Defensive: wrapped in try/catch so a Supabase/env misconfiguration can
 * never crash the entire site with MIDDLEWARE_INVOCATION_FAILED. If auth
 * refresh fails, we pass through as if the user were anonymous and log
 * the error to the edge logs.
 */
export async function updateSession(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // If env vars aren't present (e.g. during a build that predates them),
  // just pass through. The app will behave as if no user is signed in.
  if (!supabaseUrl || !supabaseKey) {
    console.warn(
      "[supabase/middleware] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY; passing through."
    );
    const passthrough = NextResponse.next({ request });
    setAnalyticsCookies(request, passthrough);
    return passthrough;
  }

  let supabaseResponse = NextResponse.next({ request });

  try {
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    });

    // IMPORTANT: This call refreshes the session if needed.
    // Must run on every request to keep the auth cookie fresh.
    await supabase.auth.getUser();
  } catch (err) {
    console.error("[supabase/middleware] Auth refresh failed:", err);
    // Pass through — let the page handle the unauthenticated state.
    const passthrough = NextResponse.next({ request });
    setAnalyticsCookies(request, passthrough);
    return passthrough;
  }

  setAnalyticsCookies(request, supabaseResponse);
  return supabaseResponse;
}
