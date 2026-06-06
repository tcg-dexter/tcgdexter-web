import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const DASHBOARD_HOST = "dashboard.tcgdexter.com";

// Paths that must NOT be rewritten under the dashboard host. These are auth
// flows (Supabase magic-link sign-in + callback) that need to reach the
// marketing app's actual routes — the admin gate at /dashboard/layout.tsx
// redirects unauthenticated users to /sign-in?next=/dashboard, and without
// these exemptions the rewrite would translate that to /dashboard/sign-in
// which 404s. Also exempt the public deck-share short URL (/d/<id>) so a
// dashboard user clicking through to a saved deck doesn't break.
const DASHBOARD_REWRITE_EXEMPT = [
  "/sign-in",
  "/sign-up",
  "/auth",
  "/d/",
];

/**
 * Root middleware. Two jobs:
 *   1. Host-route `dashboard.tcgdexter.com/*` → `/dashboard/*` (internal admin dashboard)
 *   2. Refresh the Supabase session cookie on every other request.
 */
export async function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";

  if (host === DASHBOARD_HOST) {
    const url = request.nextUrl.clone();
    const path = url.pathname;
    const isExempt = DASHBOARD_REWRITE_EXEMPT.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(prefix),
    );
    if (!path.startsWith("/dashboard") && !isExempt) {
      url.pathname = `/dashboard${path === "/" ? "" : path}`;
      return NextResponse.rewrite(url);
    }
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes — middleware doesn't need to refresh sessions for these)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico
     */
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
