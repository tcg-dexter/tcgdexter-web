import type { SpotlightCardRef, SpotlightQA } from "@/app/spotlight/types";

/** Max length of a card caption / backstory, in characters. */
export const MAX_CAPTION_LENGTH = 280;

/**
 * Coerce an untrusted array into SpotlightCardRef[].
 *
 * Defends against an arbitrary object being pasted into a card slot: every
 * entry is reduced to exactly the four known keys. An empty-string caption
 * collapses to null so the render path's "only when present" check stays a
 * simple truthiness test.
 *
 * Shared by the admin PATCH route and the participant onboarding route so the
 * two paths can't drift.
 */
export function cleanCardRefs(raw: unknown[]): SpotlightCardRef[] {
  return raw.map((entry) => {
    const r = entry as {
      set_id?: unknown;
      number?: unknown;
      name?: unknown;
      caption?: unknown;
    };
    const caption = typeof r.caption === "string" ? r.caption.trim() : "";
    return {
      set_id: typeof r.set_id === "string" ? r.set_id : "",
      number: typeof r.number === "string" ? r.number : "",
      name: typeof r.name === "string" ? r.name : "",
      caption: caption ? caption.slice(0, MAX_CAPTION_LENGTH) : null,
    };
  });
}

/** Coerce an untrusted array into SpotlightQA[]. */
export function cleanQA(raw: unknown[]): SpotlightQA[] {
  return raw.map((entry) => {
    const r = entry as { q?: unknown; a?: unknown };
    return {
      q: typeof r.q === "string" ? r.q : "",
      a: typeof r.a === "string" ? r.a : "",
    };
  });
}

/** Non-empty strings only, deduped, capped at `max`. Used for deck ids and
 *  list short ids, where the caller validates ownership separately. */
export function cleanIdList(raw: unknown[], max: number): string[] {
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v === "string" && v.length > 0) seen.add(v);
  }
  return Array.from(seen).slice(0, max);
}
