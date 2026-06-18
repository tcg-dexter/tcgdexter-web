import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Only images from these prefixes may be proxied — prevents SSRF abuse.
const ALLOWED_PREFIXES = [
  "https://images.pokemontcg.io/",
  "https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/",
  "https://images.scrydex.com/pokemon/",
];

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle<{ is_admin: boolean }>();
  if (!me?.is_admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = request.nextUrl.searchParams.get("url");
  if (!url || !ALLOWED_PREFIXES.some((p) => url.startsWith(p))) {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  const upstream = await fetch(url);
  if (!upstream.ok) {
    return NextResponse.json({ error: "upstream error" }, { status: upstream.status });
  }

  const contentType = upstream.headers.get("content-type") ?? "image/png";
  const buffer = await upstream.arrayBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400, immutable",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
