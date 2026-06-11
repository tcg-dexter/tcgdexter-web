import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import cardData from "@/data/cards-standard.json";
import { normalizeForSearch } from "@/lib/searchNormalize";

interface CardEntry {
  name: string;
  set_id: string;
  set_name?: string;
  number: string;
  supertype?: string;
  types?: string[];
  rarity?: string;
}

const CARD_DB = cardData as unknown as Record<string, CardEntry[]>;

// Flatten the catalog once per server instance. ~14MB JSON → one ~50k-entry
// flat list. Cheap to scan with a substring match; we cap returned results.
let FLAT: CardEntry[] | null = null;
function flat(): CardEntry[] {
  if (FLAT) return FLAT;
  const out: CardEntry[] = [];
  for (const [name, entries] of Object.entries(CARD_DB)) {
    for (const e of entries) {
      out.push({ ...e, name: e.name ?? name });
    }
  }
  FLAT = out;
  return out;
}

const RESULT_LIMIT = 20;

/**
 * GET /api/admin/spotlight/card-search?q=<query>
 * Admin-only. Substring search against the cards-standard.json catalog.
 * Prefix matches rank above substring matches. Returns at most 20 entries.
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

  const needle = normalizeForSearch(q);
  const prefix: CardEntry[] = [];
  const sub: CardEntry[] = [];
  for (const c of flat()) {
    const lower = normalizeForSearch(c.name);
    if (lower.startsWith(needle)) prefix.push(c);
    else if (lower.includes(needle)) sub.push(c);
    if (prefix.length >= RESULT_LIMIT) break;
  }
  const results = [...prefix, ...sub].slice(0, RESULT_LIMIT).map((c) => ({
    name: c.name,
    set_id: c.set_id,
    set_name: c.set_name ?? null,
    number: c.number,
    supertype: c.supertype ?? null,
    types: c.types ?? [],
    rarity: c.rarity ?? null,
  }));
  return NextResponse.json({ results });
}
