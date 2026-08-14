import { NextResponse } from "next/server";
import { assertDashboardAdmin } from "@/app/(dashboard)/dashboard/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { listPartners } from "@/app/(dashboard)/dashboard/partnerships/lib/queries";
import {
  PARTNER_KINDS,
  PARTNER_PRIORITIES,
  PARTNER_TIERS,
  type PartnerKind,
  type PartnerPriority,
  type PartnerTier,
} from "@/app/(dashboard)/dashboard/partnerships/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await assertDashboardAdmin();
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });
  const partners = await listPartners();
  return NextResponse.json({ partners });
}

export async function POST(req: Request) {
  const auth = await assertDashboardAdmin();
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  let body: {
    name?: string;
    handle?: string | null;
    kind?: string;
    tier?: string | null;
    priority?: string;
    note?: string;
    reach_note?: string | null;
    source_url?: string | null;
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

  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const kind = body.kind ?? "creator";
  if (!PARTNER_KINDS.includes(kind as PartnerKind)) {
    return NextResponse.json({ error: "invalid kind" }, { status: 400 });
  }
  if (body.tier != null && !PARTNER_TIERS.includes(body.tier as PartnerTier)) {
    return NextResponse.json({ error: "invalid tier" }, { status: 400 });
  }
  const priority = body.priority ?? "medium";
  if (!PARTNER_PRIORITIES.includes(priority as PartnerPriority)) {
    return NextResponse.json({ error: "invalid priority" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("partner_prospects")
    .insert({
      name,
      handle: body.handle?.trim() || null,
      kind,
      tier: body.tier || null,
      priority,
      note: body.note ?? "",
      reach_note: body.reach_note?.trim() || null,
      source_url: body.source_url?.trim() || null,
      youtube_url: body.youtube_url?.trim() || null,
      twitch_url: body.twitch_url?.trim() || null,
      tiktok_url: body.tiktok_url?.trim() || null,
      x_url: body.x_url?.trim() || null,
      instagram_url: body.instagram_url?.trim() || null,
      website_url: body.website_url?.trim() || null,
    })
    .select("id")
    .single();
  if (error) {
    // 23505 = unique_violation on partner_prospects_name_key.
    const status = error.code === "23505" ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}
