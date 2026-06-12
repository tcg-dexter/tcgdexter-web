import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/admin/social-studio/proxy-image?url=<https image url>
 *
 * Admin-only same-origin image proxy for the Social Studio. The studio's
 * PNG export (html-to-image) must fetch every <img> source with JS, and
 * the upstream card/sprite CDNs don't all send CORS headers — routing
 * the images through this endpoint makes them same-origin so both the
 * on-screen preview and the export read from the same cached bytes.
 *
 * Locked to a host allowlist so the endpoint can't be used as an open
 * relay. 502s on non-image upstream responses.
 */

const ALLOWED_HOSTS = new Set([
  "images.pokemontcg.io",
  "r2.limitlesstcg.net",
  "limitlesstcg.nyc3.digitaloceanspaces.com",
  "images.scrydex.com",
]);

function isAllowedHost(hostname: string): boolean {
  if (ALLOWED_HOSTS.has(hostname)) return true;
  // Vercel Blob (deck cover uploads) + the project's Supabase storage
  // (avatar uploads) use per-project subdomains.
  if (hostname.endsWith(".public.blob.vercel-storage.com")) return true;
  try {
    const supabaseHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
    if (supabaseHost && hostname === supabaseHost) return true;
  } catch {
    // Unset/malformed env — fall through to deny.
  }
  return false;
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Auth required" }, { status: 401 });
  }
  const { data: me } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle<{ is_admin: boolean }>();
  if (!me?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const raw = new URL(req.url).searchParams.get("url");
  if (!raw) {
    return NextResponse.json({ error: "Missing url param" }, { status: 400 });
  }
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }
  if (target.protocol !== "https:" || !isAllowedHost(target.hostname)) {
    return NextResponse.json({ error: "Host not allowed" }, { status: 400 });
  }

  const upstream = await fetch(target.toString());
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Upstream fetch failed" }, { status: 502 });
  }
  const contentType = upstream.headers.get("content-type") ?? "image/png";
  if (!contentType.startsWith("image/")) {
    return NextResponse.json({ error: "Upstream is not an image" }, { status: 502 });
  }

  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": contentType,
      // Card art is immutable per URL; let the admin's browser keep it.
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}
