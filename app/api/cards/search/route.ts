import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchCards } from "@/lib/cardSearch";

const RESULT_LIMIT = 20;

/**
 * GET /api/cards/search?q=<query>
 *
 * Auth required (any signed-in user, not admin-only). Powers the profile
 * team-card picker — same catalog and ranking as /cards, capped to 20
 * results and trimmed to the fields the picker needs.
 */
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const { cards } = searchCards({ q, pageSize: RESULT_LIMIT });
  const results = cards.map((c) => ({
    name: c.name,
    set_id: c.setId,
    set_name: c.setName,
    number: c.number,
    supertype: c.supertype,
    types: c.types,
    rarity: c.rarity,
  }));
  return NextResponse.json({ results });
}
