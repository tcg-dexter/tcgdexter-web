import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const DASHBOARD_HOST = "dashboard.tcgdexter.com";

/**
 * Root middleware. Two jobs:
 *   1. Host-route `dashboard.tcgdexter.com/*` → `/dashboard/*` (internal admin dashboard)
 *   2. Refresh the Supabase session cookie on every other request.
 */
export async function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";

  if (host === DASHBOARD_HOST) {
    const url = request.nextUrl.clone();
    if (!url.pathname.startsWith("/dashboard")) {
      url.pathname = `/dashboard${url.pathname === "/" ? "" : url.pathname}`;
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
