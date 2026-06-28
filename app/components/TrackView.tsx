"use client";

import { useEffect, useRef } from "react";
import { trackClient } from "@/lib/analytics/trackClient";

/**
 * Fires a single analytics event once on mount — a drop-in way to record a
 * page/section view from an otherwise server-rendered page. Renders nothing.
 *
 *   <TrackView event="spotlight.viewed" properties={{ slug }} />
 */
export default function TrackView({
  event,
  properties,
}: {
  event: string;
  properties?: Record<string, unknown>;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    trackClient(event, properties);
    // Intentionally fire only once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
