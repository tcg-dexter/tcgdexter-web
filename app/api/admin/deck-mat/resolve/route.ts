import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseDeckListCards } from "@/lib/cardPrinting";
import { resolveDeckTiles } from "@/lib/deckTiles";

export async function POST(req: Request) {
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

  const body = await req.json().catch(() => null);
  const deckList = body && typeof body.deckList === "string" ? body.deckList : "";
  if (!deckList.trim()) {
    return NextResponse.json({ tiles: [] });
  }

  const parsed = parseDeckListCards(deckList);
  const tiles = resolveDeckTiles(parsed);
  return NextResponse.json({ tiles });
}
