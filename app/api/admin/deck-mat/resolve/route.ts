import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseDeckListCards } from "@/lib/cardPrinting";
import { resolveDeckTiles } from "@/lib/deckTiles";

/**
 * Resolve a raw deck list to render-ready tiles for Playmat Studio.
 *
 * Sign-in required. The route used to also require is_admin=true but
 * Playmat Studio is now exposed to every signed-in user with a saved
 * deck via the home page CTA, so the admin gate was unreachable in
 * practice — non-admin clickers hit 403 the moment they picked a deck.
 * The request body carries only deck-list text the caller submits,
 * which (a) doesn't read DB rows other than the caller's own and
 * (b) doesn't write anything, so signed-in is the right floor.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const deckList = body && typeof body.deckList === "string" ? body.deckList : "";
  if (!deckList.trim()) {
    return NextResponse.json({ tiles: [] });
  }

  const parsed = parseDeckListCards(deckList);
  const tiles = resolveDeckTiles(parsed);
  return NextResponse.json({ tiles });
}
