import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { track } from "@/lib/analytics/track";

/**
 * POST   /api/lists/[id]/items   — add a card to a list (idempotent)
 * DELETE /api/lists/[id]/items?setId=&number=   — remove a card (idempotent)
 *
 * Both only require the caller to be signed in — RLS on list_items (scoped
 * via list_items_owner_* through list_id -> lists.user_id) is the actual
 * authorization boundary. A cross-user attempt just silently affects 0 rows
 * rather than needing an explicit ownership check here.
 */

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  let body: { setId?: string; number?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { setId, number } = body;
  if (!setId || typeof setId !== "string" || !number || typeof number !== "string") {
    return NextResponse.json({ error: "setId and number are required." }, { status: 400 });
  }

  const { error } = await supabase
    .from("list_items")
    .insert({ list_id: id, set_id: setId, number });

  // 23505 = unique violation (already in this list) — treat as success.
  // Other codes surface: 42501 = RLS denial (not your list) -> 403.
  if (error && error.code !== "23505") {
    return NextResponse.json(
      { error: error.message },
      { status: error.code === "42501" ? 403 : 400 },
    );
  }

  void track(req, "list.card_added", { listId: id, setId, number });

  return NextResponse.json({ added: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const url = new URL(req.url);
  const setId = url.searchParams.get("setId");
  const number = url.searchParams.get("number");
  if (!setId || !number) {
    return NextResponse.json({ error: "setId and number are required." }, { status: 400 });
  }

  const { error } = await supabase
    .from("list_items")
    .delete()
    .eq("list_id", id)
    .eq("set_id", setId)
    .eq("number", number);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  void track(req, "list.card_removed", { listId: id, setId, number });

  return NextResponse.json({ added: false });
}
