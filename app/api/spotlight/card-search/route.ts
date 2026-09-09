import { NextResponse } from "next/server";
import { searchCards } from "@/lib/cardSearch";
import { requireInvitedSpotlight } from "@/lib/spotlight/onboarding";

// Matches /api/admin/spotlight/card-search — the onboarding form uses the
// same CardSearchPicker, so it needs the same depth of results.
const RESULT_LIMIT = 60;

/**
 * GET /api/spotlight/card-search?q=<query>
 *
 * The participant-facing twin of /api/admin/spotlight/card-search: identical
 * search and result shape, gated on "you have an open spotlight invitation"
 * rather than on is_admin. Kept as a separate route rather than relaxing the
 * admin one so the admin surface stays admin-only.
 */
export async function GET(req: Request) {
  const ctx = await requireInvitedSpotlight();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
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
