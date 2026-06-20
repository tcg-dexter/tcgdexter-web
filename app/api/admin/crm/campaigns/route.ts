import { NextResponse } from "next/server";
import { assertDashboardAdmin } from "@/app/(dashboard)/dashboard/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  listCampaigns,
  syncCampaignRecipients,
} from "@/app/(dashboard)/dashboard/crm/lib/queries";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET() {
  const auth = await assertDashboardAdmin();
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });
  const campaigns = await listCampaigns();
  return NextResponse.json({ campaigns });
}

export async function POST(req: Request) {
  const auth = await assertDashboardAdmin();
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  let body: {
    name?: string;
    subject?: string;
    body?: string;
    recipient_type?: string;
    signup_window_start?: string | null;
    signup_window_end?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const recipientType =
    body.recipient_type === "signup_window" ? "signup_window" : "manual";

  let windowStart: string | null = null;
  let windowEnd: string | null = null;
  if (recipientType === "signup_window") {
    windowStart = body.signup_window_start ?? null;
    windowEnd = body.signup_window_end ?? null;
    if (!windowStart || !windowEnd || !DATE_RE.test(windowStart) || !DATE_RE.test(windowEnd)) {
      return NextResponse.json(
        { error: "signup_window_start and signup_window_end required (YYYY-MM-DD)" },
        { status: 400 },
      );
    }
    if (windowEnd < windowStart) {
      return NextResponse.json(
        { error: "signup_window_end must be on or after signup_window_start" },
        { status: 400 },
      );
    }
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("email_campaigns")
    .insert({
      name,
      subject: body.subject ?? "",
      body: body.body ?? "",
      created_by: auth.userId,
      recipient_type: recipientType,
      signup_window_start: windowStart,
      signup_window_end: windowEnd,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Initial backfill — for rule-based campaigns this pulls in every user
  // already inside the window so the recipient list is non-empty on first
  // visit to the detail page.
  if (recipientType === "signup_window") {
    await syncCampaignRecipients(data.id);
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}
