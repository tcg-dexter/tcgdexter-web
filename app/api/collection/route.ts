import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  isValidVariant,
  type CollectionEntry,
  type CollectionVariantKey,
} from "@/lib/inventory";

/**
 * GET /api/collection
 *
 * Returns every (set_id, number, variant) the signed-in user has at
 * least one of. Used by the catalog to render per-card capsule counts.
 * Zero-quantity rows are filtered out and removed lazily by the POST
 * handler when a decrement drives quantity to zero.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  // PostgREST caps rows per response at db.maxRows (default 1000). Collections
  // bigger than that — e.g. after a bulk import — would silently truncate, so
  // page through with explicit ranges until we exhaust.
  const PAGE = 1000;
  const all: Array<{ set_id: string; number: string; variant: string; quantity: number }> = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("user_card_collection")
      .select("set_id, number, variant, quantity")
      .eq("user_id", user.id)
      .gt("quantity", 0)
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("[collection] select failed:", error);
      return NextResponse.json({ error: "Failed to load collection." }, { status: 500 });
    }
    if (!data?.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }

  // CollectionEntry.variant is typed as the canonical key set but the table
  // also stores exotic variants from bulk imports. The UI filters those out
  // for per-variant rendering; here we just pass the raw string through.
  const items: CollectionEntry[] = all.map((r) => ({
    setId: r.set_id,
    number: r.number,
    variant: r.variant as CollectionVariantKey,
    quantity: r.quantity,
  }));

  return NextResponse.json({ items });
}

/**
 * POST /api/collection
 *
 * Applies an integer delta to the (set_id, number, variant) row for
 * the signed-in user. Quantity is clamped at zero; rows that hit zero
 * are deleted so they don't show up in subsequent GETs.
 *
 * Body: { setId: string, number: string, variant: string, delta: number }
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  let body: { setId?: string; number?: string; variant?: string; delta?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { setId, number, variant, delta } = body;
  if (!setId || !number || !variant) {
    return NextResponse.json(
      { error: "setId, number, variant required" },
      { status: 400 },
    );
  }
  if (!isValidVariant(variant)) {
    return NextResponse.json({ error: "Unknown variant" }, { status: 400 });
  }
  if (typeof delta !== "number" || !Number.isInteger(delta) || delta === 0) {
    return NextResponse.json({ error: "delta must be a non-zero integer" }, { status: 400 });
  }

  // Read-modify-write on a row keyed by (user_id, set_id, number, variant).
  // The composite primary key prevents duplicates; concurrent clicks on the
  // same variant will serialize through Postgres's row lock during update.
  const { data: existing } = await supabase
    .from("user_card_collection")
    .select("quantity")
    .eq("user_id", user.id)
    .eq("set_id", setId)
    .eq("number", number)
    .eq("variant", variant)
    .maybeSingle();

  const current = existing?.quantity ?? 0;
  const next = Math.max(0, current + delta);

  if (next === current) {
    return NextResponse.json({ quantity: current });
  }

  if (next === 0) {
    const { error } = await supabase
      .from("user_card_collection")
      .delete()
      .eq("user_id", user.id)
      .eq("set_id", setId)
      .eq("number", number)
      .eq("variant", variant);
    if (error) {
      console.error("[collection] delete failed:", error);
      return NextResponse.json({ error: "Failed to update collection." }, { status: 500 });
    }
  } else {
    const { error } = await supabase
      .from("user_card_collection")
      .upsert(
        {
          user_id: user.id,
          set_id: setId,
          number,
          variant,
          quantity: next,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,set_id,number,variant" },
      );
    if (error) {
      console.error("[collection] upsert failed:", error);
      return NextResponse.json({ error: "Failed to update collection." }, { status: 500 });
    }
  }

  return NextResponse.json({ quantity: next });
}
