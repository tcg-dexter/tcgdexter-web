import type { PartnerProspect } from "./types";

// Small creator/site avatars via unavatar.io — a public proxy that resolves
// a platform + handle to that platform's current profile picture (or a
// domain's favicon) at request time. We deliberately don't store or fetch
// images ourselves: this environment's egress proxy blocks direct requests
// to every social/creator-directory domain (see the seed file header), and
// a live proxy also means the avatar tracks the real profile instead of
// going stale. Only rows with an actual profile/website URL get one — rows
// captured only via a third-party aggregator link (no direct URL) fall back
// to an initials avatar in the UI.
function firstPathSegment(urlStr: string): string | null {
  try {
    const { pathname } = new URL(urlStr);
    let seg = pathname.split("/").filter(Boolean)[0];
    if (!seg) return null;
    if (seg.startsWith("@")) seg = seg.slice(1);
    return decodeURIComponent(seg);
  } catch {
    return null;
  }
}

export function getAvatarUrl(p: PartnerProspect): string | null {
  if (p.x_url) {
    const h = firstPathSegment(p.x_url);
    if (h) return `https://unavatar.io/x/${encodeURIComponent(h)}`;
  }
  if (p.instagram_url) {
    const h = firstPathSegment(p.instagram_url);
    if (h) return `https://unavatar.io/instagram/${encodeURIComponent(h)}`;
  }
  if (p.twitch_url) {
    const h = firstPathSegment(p.twitch_url);
    if (h) return `https://unavatar.io/twitch/${encodeURIComponent(h)}`;
  }
  // /channel/UC... ids aren't a resolvable handle for unavatar — only use
  // youtube_url when it's a normal @handle-style profile URL.
  if (p.youtube_url && !p.youtube_url.includes("/channel/")) {
    const h = firstPathSegment(p.youtube_url);
    if (h) return `https://unavatar.io/youtube/${encodeURIComponent(h)}`;
  }
  if (p.tiktok_url) {
    const h = firstPathSegment(p.tiktok_url);
    if (h) return `https://unavatar.io/tiktok/${encodeURIComponent(h)}`;
  }
  if (p.website_url) {
    try {
      const { hostname } = new URL(p.website_url);
      return `https://unavatar.io/${hostname}`;
    } catch {
      return null;
    }
  }
  return null;
}

export function getInitials(name: string): string {
  const words = name.replace(/^@/, "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
