import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { analyzeDeckList, detectDeckArchetype } from "@/lib/analyzeDeck";
import { simulateMatchup, SimDeckError, SIM_VERSION, hashSeed } from "@/lib/engine/sim";
import type { SimResult } from "@/lib/engine/sim";
import { matchupPrior, type MatchupPrior } from "@/lib/ml/matchup";

/**
 * POST /api/simulate  (ML pipeline Phase 3; admin-gated during rollout)
 *
 * Body: { deck_a: string, deck_b: string, n?: number }
 * Runs N seeded engine rollouts between the two deck lists. The seed is
 * derived from the deck pair, so results are deterministic and cacheable;
 * an archetype-matchup prior rides along as the instant fast path.
 */

const N_DEFAULT = 200;
const N_MAX = 500;
const N_MIN = 10;
const DECK_TEXT_MAX = 8000;
const CACHE_MAX = 50;

export interface SimulateResponse {
  sim: SimResult;
  cached: boolean;
  prior: MatchupPrior | null;
  archetype_a: string | null;
  archetype_b: string | null;
}

// Per-instance cache (serverless instances each keep their own; the
// deterministic seed keeps answers identical across instances anyway).
const cache = new Map<string, Omit<SimulateResponse, "cached">>();

function detectArchetype(deckList: string): string | null {
  try {
    return detectDeckArchetype(analyzeDeckList(deckList)).archetypeName;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Auth required" }, { status: 401 });

  const { data: me } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle<{ is_admin: boolean }>();
  if (!me?.is_admin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  let body: { deck_a?: unknown; deck_b?: unknown; n?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const deckA = typeof body.deck_a === "string" ? body.deck_a.trim() : "";
  const deckB = typeof body.deck_b === "string" ? body.deck_b.trim() : "";
  if (!deckA || !deckB) {
    return NextResponse.json({ error: "deck_a and deck_b are required" }, { status: 400 });
  }
  if (deckA.length > DECK_TEXT_MAX || deckB.length > DECK_TEXT_MAX) {
    return NextResponse.json({ error: "Deck list too large" }, { status: 400 });
  }
  const nRaw = typeof body.n === "number" ? body.n : N_DEFAULT;
  const n = Math.min(N_MAX, Math.max(N_MIN, Math.floor(nRaw)));

  const key = createHash("sha256")
    .update(`${SIM_VERSION}|${n}|${deckA}|${deckB}`)
    .digest("hex");
  const hit = cache.get(key);
  if (hit) return NextResponse.json({ ...hit, cached: true });

  try {
    const sim = simulateMatchup(deckA, deckB, { n, seed: hashSeed(key) });
    const archetypeA = detectArchetype(deckA);
    const archetypeB = detectArchetype(deckB);
    const payload: Omit<SimulateResponse, "cached"> = {
      sim,
      prior: matchupPrior(archetypeA, archetypeB),
      archetype_a: archetypeA,
      archetype_b: archetypeB,
    };
    cache.set(key, payload);
    if (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    return NextResponse.json({ ...payload, cached: false });
  } catch (e) {
    if (e instanceof SimDeckError) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    return NextResponse.json(
      { error: `Simulation failed: ${e instanceof Error ? e.message : e}` },
      { status: 500 },
    );
  }
}
