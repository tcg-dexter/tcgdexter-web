import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/profile/tcg-live-handle
 *
 * Returns the signed-in user's saved TCG Live handle (or null).
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("tcg_live_handle")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[profile/tcg-live-handle] select failed:", error);
    return NextResponse.json({ error: "Failed to load." }, { status: 500 });
  }

  return NextResponse.json({ tcg_live_handle: data?.tcg_live_handle ?? null });
}

/**
 * POST /api/profile/tcg-live-handle
 *
 * Sets or clears the user's TCG Live handle. Pass `{ tcg_live_handle: null }`
 * to clear.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  let body: { tcg_live_handle?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const handle =
    typeof body.tcg_live_handle === "string" ? body.tcg_live_handle.trim() : null;

  if (handle && (handle.length < 1 || handle.length > 40)) {
    return NextResponse.json(
      { error: "Handle must be 1–40 characters." },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("profiles")
    .update({ tcg_live_handle: handle || null })
    .eq("id", user.id);

  if (error) {
    console.error("[profile/tcg-live-handle] update failed:", error);
    return NextResponse.json({ error: "Failed to save." }, { status: 500 });
  }

  return NextResponse.json({ tcg_live_handle: handle || null });
}
