import { NextResponse } from "next/server";
import { assertDashboardAdmin } from "@/app/(dashboard)/dashboard/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await assertDashboardAdmin();
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  let body: { user_ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const ids = Array.isArray(body.user_ids) ? body.user_ids.filter((id) => typeof id === "string") : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "user_ids required" }, { status: 400 });
  }

  const admin = createAdminClient();
  // Idempotent: the unique(campaign_id, recipient_user_id) constraint means
  // re-adding an existing recipient is a no-op rather than a duplicate.
  const rows = ids.map((user_id) => ({
    campaign_id: params.id,
    recipient_user_id: user_id,
  }));
  const { error } = await admin
    .from("email_sends")
    .upsert(rows, { onConflict: "campaign_id,recipient_user_id", ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, added: ids.length });
}
