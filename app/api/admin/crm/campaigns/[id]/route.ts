import { NextResponse } from "next/server";
import { assertDashboardAdmin } from "@/app/(dashboard)/dashboard/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getCampaign,
  syncCampaignRecipients,
} from "@/app/(dashboard)/dashboard/crm/lib/queries";
import type {
  CampaignStatus,
  RecipientType,
} from "@/app/(dashboard)/dashboard/crm/lib/types";

export const dynamic = "force-dynamic";

const VALID_STATUSES: CampaignStatus[] = ["draft", "sending", "complete"];
const VALID_RECIPIENT_TYPES: RecipientType[] = ["manual", "signup_window"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

  let body: {
    name?: string;
    subject?: string;
    body?: string;
    status?: string;
    recipient_type?: string;
    signup_window_start?: string | null;
    signup_window_end?: string | null;
  };
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

  // Recipient rule changes — when switching to signup_window we need both
  // bounds. When switching back to manual we clear the window so the check
  // constraint is satisfied even on a future toggle.
  let needsResync = false;
  if (typeof body.recipient_type === "string") {
    const rt = body.recipient_type as RecipientType;
    if (!VALID_RECIPIENT_TYPES.includes(rt)) {
      return NextResponse.json({ error: "invalid recipient_type" }, { status: 400 });
    }
    patch.recipient_type = rt;
    if (rt === "manual") {
      patch.signup_window_start = null;
      patch.signup_window_end = null;
    } else {
      const ws = body.signup_window_start;
      const we = body.signup_window_end;
      if (!ws || !we || !DATE_RE.test(ws) || !DATE_RE.test(we)) {
        return NextResponse.json(
          { error: "signup_window_start and signup_window_end required (YYYY-MM-DD)" },
          { status: 400 },
        );
      }
      if (we < ws) {
        return NextResponse.json(
          { error: "signup_window_end must be on or after signup_window_start" },
          { status: 400 },
        );
      }
      patch.signup_window_start = ws;
      patch.signup_window_end = we;
      needsResync = true;
    }
  } else {
    // Window-only edit (recipient_type unchanged but dates may have moved).
    if (body.signup_window_start !== undefined) {
      const ws = body.signup_window_start;
      if (ws !== null && (typeof ws !== "string" || !DATE_RE.test(ws))) {
        return NextResponse.json({ error: "invalid signup_window_start" }, { status: 400 });
      }
      patch.signup_window_start = ws;
      needsResync = true;
    }
    if (body.signup_window_end !== undefined) {
      const we = body.signup_window_end;
      if (we !== null && (typeof we !== "string" || !DATE_RE.test(we))) {
        return NextResponse.json({ error: "invalid signup_window_end" }, { status: 400 });
      }
      patch.signup_window_end = we;
      needsResync = true;
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("email_campaigns").update(patch).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (needsResync) {
    await syncCampaignRecipients(params.id);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await assertDashboardAdmin();
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  // email_sends rows cascade via the FK ON DELETE CASCADE in the migration,
  // so the per-recipient history is removed alongside the campaign.
  const admin = createAdminClient();
  const { error } = await admin.from("email_campaigns").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
