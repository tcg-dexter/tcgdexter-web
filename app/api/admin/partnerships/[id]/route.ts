import { NextResponse } from "next/server";
import { assertDashboardAdmin } from "@/app/(dashboard)/dashboard/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  PARTNER_KINDS,
  PARTNER_PRIORITIES,
  PARTNER_STATUSES,
  PARTNER_TIERS,
  type PartnerKind,
  type PartnerPriority,
  type PartnerStatus,
  type PartnerTier,
} from "@/app/(dashboard)/dashboard/partnerships/lib/types";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await assertDashboardAdmin();
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  let body: {
    name?: string;
    handle?: string | null;
    kind?: string;
    tier?: string | null;
    priority?: string;
    status?: string;
    note?: string;
    reach_note?: string | null;
    source_url?: string | null;
    links_verified?: boolean;
    youtube_url?: string | null;
    twitch_url?: string | null;
    tiktok_url?: string | null;
    x_url?: string | null;
    instagram_url?: string | null;
    website_url?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    patch.name = name;
  }
  if (body.handle !== undefined) patch.handle = body.handle?.trim() || null;
  if (typeof body.kind === "string") {
    if (!PARTNER_KINDS.includes(body.kind as PartnerKind)) {
      return NextResponse.json({ error: "invalid kind" }, { status: 400 });
    }
    patch.kind = body.kind;
  }
  if (body.tier !== undefined) {
    if (body.tier != null && !PARTNER_TIERS.includes(body.tier as PartnerTier)) {
      return NextResponse.json({ error: "invalid tier" }, { status: 400 });
    }
    patch.tier = body.tier || null;
  }
  if (typeof body.priority === "string") {
    if (!PARTNER_PRIORITIES.includes(body.priority as PartnerPriority)) {
      return NextResponse.json({ error: "invalid priority" }, { status: 400 });
    }
    patch.priority = body.priority;
  }
  if (typeof body.status === "string") {
    if (!PARTNER_STATUSES.includes(body.status as PartnerStatus)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }
    patch.status = body.status;
  }
  if (typeof body.note === "string") patch.note = body.note;
  if (body.reach_note !== undefined) patch.reach_note = body.reach_note?.trim() || null;
  if (body.source_url !== undefined) patch.source_url = body.source_url?.trim() || null;
  if (typeof body.links_verified === "boolean") patch.links_verified = body.links_verified;
  if (body.youtube_url !== undefined) patch.youtube_url = body.youtube_url?.trim() || null;
  if (body.twitch_url !== undefined) patch.twitch_url = body.twitch_url?.trim() || null;
  if (body.tiktok_url !== undefined) patch.tiktok_url = body.tiktok_url?.trim() || null;
  if (body.x_url !== undefined) patch.x_url = body.x_url?.trim() || null;
  if (body.instagram_url !== undefined) patch.instagram_url = body.instagram_url?.trim() || null;
  if (body.website_url !== undefined) patch.website_url = body.website_url?.trim() || null;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  const admin = createAdminClient();
  const { error } = await admin
    .from("partner_prospects")
    .update(patch)
    .eq("id", params.id);
  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await assertDashboardAdmin();
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  const admin = createAdminClient();
  const { error } = await admin.from("partner_prospects").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
