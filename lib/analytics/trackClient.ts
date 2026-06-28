/**
 * Fire-and-forget client-side event tracker. Posts to /api/track, which
 * validates the event and forwards to the server-side `track()` (so identity,
 * cookies, and headers are resolved server-side exactly like API-route events).
 *
 * Use for surfaces whose meaningful action happens entirely in the browser
 * (e.g. a canvas export, a page view) where there's no natural API round-trip
 * to hang a server-side `track()` on.
 *
 *   trackClient("playmat.exported", { style: "fire" });
 *
 * Never throws; analytics must never break a user interaction.
 */
export function trackClient(
  event: string,
  properties: Record<string, unknown> = {},
): void {
  if (typeof window === "undefined") return;
  try {
    const body = JSON.stringify({ event, properties });
    // sendBeacon is reliable across navigations/unload and includes
    // same-origin cookies (needed for user/session attribution).
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
  } catch {
    // swallow — analytics is best-effort
  }
}
