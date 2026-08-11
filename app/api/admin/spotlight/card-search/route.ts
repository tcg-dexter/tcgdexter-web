import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchCards } from "@/lib/cardSearch";

// Higher than /api/cards/search's 20 — an admin hunting for one specific
// printing of a popular Pokémon (many "Garchomp ex" reprints etc.) needs to
// see deeper into the match list than a quick-pick autocomplete does. The
// picker's result panel already scrolls (max-h-96 overflow-y-auto).
const RESULT_LIMIT = 60;

/**
 * GET /api/admin/spotlight/card-search?q=<query>
 * Admin-only. Same tokenized name/effect/artist search and ranking as the
 * public catalog (lib/cardSearch) — previously this route ran its own
 * plain substring match against the raw JSON, which (a) couldn't match a
 * query like "Garchomp EX" against the catalog's "Garchomp-EX" name (no
 * hyphen/space normalization) and (b) capped at the first 20 catalog-order
 * hits, silently hiding older printings of prolific cards.
 */
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

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const { cards } = searchCards({ q, pageSize: RESULT_LIMIT });
  const results = cards.map((c) => ({
    name: c.name,
    set_id: c.setId,
    set_name: c.setName ?? null,
    number: c.number,
    supertype: c.supertype ?? null,
    types: c.types ?? [],
    rarity: c.rarity ?? null,
  }));
  return NextResponse.json({ results });
}
