import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { track } from "@/lib/analytics/track";

/**
 * POST /api/deck-share
 *
 * Persists a deck list + analysis snapshot under a short id and returns
 * the public URL. Sign-in required — anonymous callers receive 401.
 */
export async function POST(req: Request) {
  let body: {
    deckList?: string;
    analysis?: unknown;
    /**
     * Origin of the share. When "meta", we fire a parallel
     * `meta.deck.shared` event so the Meta Archetypes Product can count it.
     */
    source?: "meta";
    metaArchetypeId?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { deckList, analysis, source, metaArchetypeId } = body;

  if (!deckList || typeof deckList !== "string" || !deckList.trim()) {
    return NextResponse.json(
      { error: "deckList is required" },
      { status: 400 }
    );
  }
  if (!analysis || typeof analysis !== "object") {
    return NextResponse.json(
      { error: "analysis is required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Sign in required to share decks" },
      { status: 401 }
    );
  }

  const shortId = nanoid(8);

  const { error } = await supabase.from("deck_shares").insert({
    id: shortId,
    user_id: user.id,
    deck_list: deckList,
    analysis,
  });

  if (error) {
    console.error("[deck-share] insert failed:", error);
    return NextResponse.json(
      { error: "Failed to share deck" },
      { status: 500 }
    );
  }

  // Build the share URL from the request origin so preview deploys return
  // preview URLs and prod returns https://tcgdexter.com. Respects Vercel's
  // x-forwarded-* headers for correct scheme/host resolution.
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto") ?? "https";
  const origin = forwardedHost
    ? `${forwardedProto}://${forwardedHost}`
    : new URL(req.url).origin;

  void track(req, "deck.shared", { short_id: shortId, source: source ?? null });

  if (source === "meta") {
    void track(req, "meta.deck.shared", {
      short_id: shortId,
      meta_archetype_id: metaArchetypeId ?? null,
    });
  }

  return NextResponse.json({
    shortId,
    url: `${origin}/d/${shortId}`,
  });
}
