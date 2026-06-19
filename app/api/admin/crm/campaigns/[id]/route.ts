import { NextResponse } from "next/server";
import { assertDashboardAdmin } from "@/app/(dashboard)/dashboard/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCampaign } from "@/app/(dashboard)/dashboard/crm/lib/queries";
import type { CampaignStatus } from "@/app/(dashboard)/dashboard/crm/lib/types";

export const dynamic = "force-dynamic";

const VALID_STATUSES: CampaignStatus[] = ["draft", "sending", "complete"];

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await assertDashboardAdmin();
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });
  const campaign = await getCampaign(params.id);
  if (!campaign) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ campaign });
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await assertDashboardAdmin();
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  let body: { name?: string; subject?: string; body?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") patch.name = body.name.trim();
  if (typeof body.subject === "string") patch.subject = body.subject;
  if (typeof body.body === "string") patch.body = body.body;
  if (typeof body.status === "string") {
    if (!VALID_STATUSES.includes(body.status as CampaignStatus)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }
    patch.status = body.status;
    patch.completed_at = body.status === "complete" ? new Date().toISOString() : null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("email_campaigns").update(patch).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
