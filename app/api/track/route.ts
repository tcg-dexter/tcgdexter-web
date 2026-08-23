import { NextResponse } from "next/server";
import { track } from "@/lib/analytics/track";

/**
 * POST /api/track
 *
 * Thin client → server bridge for browser-originated analytics events. The
 * server-side `track()` does all identity/cookie/header resolution; this route
 * only validates the event name and forwards. Disallowed events are ignored
 * silently (204) so a misbehaving client can't pollute the events table or
 * learn what's accepted.
 *
 * Body: { event: string, properties?: object }
 */

// Event-name prefixes a browser client is permitted to emit. Server-only
// events (auth, deck, battle, analyze, meta) are never accepted here.
const ALLOWED_PREFIXES = new Set(["playmat", "spotlight", "learn"]);
const EVENT_RE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export async function POST(req: Request) {
  let body: { event?: unknown; properties?: unknown };
  try {
    body = await req.json();
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const event = typeof body.event === "string" ? body.event : "";
  if (!EVENT_RE.test(event) || !ALLOWED_PREFIXES.has(event.split(".")[0])) {
    return new NextResponse(null, { status: 204 });
  }

  const properties =
    body.properties && typeof body.properties === "object" && !Array.isArray(body.properties)
      ? (body.properties as Record<string, unknown>)
      : {};

  await track(req, event, properties);
  return new NextResponse(null, { status: 204 });
}
