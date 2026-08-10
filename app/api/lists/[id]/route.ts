import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { track } from "@/lib/analytics/track";

/**
 * PATCH /api/lists/[id]
 *   body: { name?: string, is_public?: boolean }
 *   Flipping is_public to true re-checks the publish gate (profile must be
 *   public), same as POST /api/lists.
 *
 * DELETE /api/lists/[id]
 *   Cascades list_items via FK.
 *
 * Both require authentication; RLS on public.lists scopes every write to
 * the caller's own rows.
 */

export async function PATCH(
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

  let body: { name?: string; is_public?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) {
      return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    }
    updates.name = name;
  }

  if (typeof body.is_public === "boolean") {
    if (body.is_public) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("is_public")
        .eq("id", user.id)
        .maybeSingle();
      if (!profile?.is_public) {
        return NextResponse.json(
          { error: "Make your profile public before sharing lists." },
          { status: 422 },
        );
      }
    }
    updates.is_public = body.is_public;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { error } = await supabase.from("lists").update(updates).eq("id", id);

  if (error) {
    console.error("[lists] update failed:", error);
    return NextResponse.json({ error: "Failed to update list." }, { status: 500 });
  }

  const eventName =
    "is_public" in updates
      ? updates.is_public === true
        ? "list.published"
        : "list.unpublished"
      : "name" in updates
        ? "list.renamed"
        : "list.updated";
  void track(req, eventName, { id, fields: Object.keys(updates) });

  return NextResponse.json({ success: true, ...updates });
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

  const { error } = await supabase.from("lists").delete().eq("id", id);

  if (error) {
    console.error("[lists] delete failed:", error);
    return NextResponse.json({ error: "Failed to delete list." }, { status: 500 });
  }

  void track(req, "list.deleted", { id });

  return NextResponse.json({ success: true });
}
