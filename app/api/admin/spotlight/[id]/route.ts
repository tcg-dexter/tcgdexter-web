import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, error: "Auth required" as const, status: 401 };
  const { data: me } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle<{ is_admin: boolean }>();
  if (!me?.is_admin) {
    return { supabase, error: "Forbidden" as const, status: 403 };
  }
  return { supabase };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await requireAdmin();
  if (ctx.error) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  const { supabase } = ctx;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Whitelist editable fields. Validate featured_deck_ids and qa shape.
  const update: Record<string, unknown> = {};
  if (typeof body.slug === "string") update.slug = body.slug.trim().toLowerCase();
  if (body.headline === null || typeof body.headline === "string") {
    update.headline = body.headline;
  }
  for (const key of [
    "favorite_pokemon",
    "favorite_collection_card",
    "favorite_format_card",
  ] as const) {
    if (key in body) update[key] = body[key];
  }
  if (Array.isArray(body.featured_deck_ids)) {
    const ids = (body.featured_deck_ids as unknown[]).filter(
      (v): v is string => typeof v === "string" && v.length > 0
    );
    if (ids.length > 3) {
      return NextResponse.json(
        { error: "featured_deck_ids: max 3" },
        { status: 400 }
      );
    }
    if (ids.length > 0) {
      const { data: foundDecks } = await supabase
        .from("saved_decks")
        .select("id")
        .in("id", ids);
      const foundIds = new Set((foundDecks ?? []).map((d) => d.id));
      const missing = ids.filter((i) => !foundIds.has(i));
      if (missing.length > 0) {
        return NextResponse.json(
          { error: `Unknown deck id: ${missing.join(", ")}` },
          { status: 400 }
        );
      }
    }
    update.featured_deck_ids = ids;
  }
  if (Array.isArray(body.qa)) {
    update.qa = (body.qa as Array<{ q?: unknown; a?: unknown }>).map((item) => ({
      q: typeof item.q === "string" ? item.q : "",
      a: typeof item.a === "string" ? item.a : "",
    }));
  }
  if (body.avatar_image_position && typeof body.avatar_image_position === "object") {
    const pos = body.avatar_image_position as { x?: unknown; y?: unknown };
    const clamp = (v: unknown) => {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) return 50;
      return Math.max(0, Math.min(100, n));
    };
    update.avatar_image_position = { x: clamp(pos.x), y: clamp(pos.y) };
  }
  if (typeof body.is_published === "boolean") {
    update.is_published = body.is_published;
    // First publish sets published_at; subsequent toggles preserve it.
    if (body.is_published) {
      const { data: existing } = await supabase
        .from("trainer_spotlights")
        .select("published_at")
        .eq("id", id)
        .maybeSingle<{ published_at: string | null }>();
      if (!existing?.published_at) {
        update.published_at = new Date().toISOString();
      }
    }
  }

  const { error } = await supabase
    .from("trainer_spotlights")
    .update(update)
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await requireAdmin();
  if (ctx.error) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  const { error } = await ctx.supabase
    .from("trainer_spotlights")
    .delete()
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
