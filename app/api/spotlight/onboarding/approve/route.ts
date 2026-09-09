import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireInvitedSpotlight } from "@/lib/spotlight/onboarding";

const MAX_NOTE = 2000;

/**
 * POST /api/spotlight/onboarding/approve
 * Body: { note?: string }
 *
 * The trainer signing off on the admin's edited version. Only valid from
 * "in_review" — the status an admin sets once the spotlight is edited and
 * ready to be looked at.
 *
 * Approval does not publish. The admin still presses Publish on the preview
 * page, exactly as before.
 */
export async function POST(req: Request) {
  const ctx = await requireInvitedSpotlight();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  const { spotlight } = ctx;
  if (spotlight.submission_status !== "in_review") {
    return NextResponse.json(
      { error: "There's nothing waiting for your approval right now." },
      { status: 409 },
    );
  }

  let note = "";
  try {
    const body = (await req.json()) as { note?: unknown };
    if (typeof body.note === "string") note = body.note.trim().slice(0, MAX_NOTE);
  } catch {
    // No body is fine — approving without a note is the common case.
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("trainer_spotlights")
    .update({
      submission_status: "approved",
      approved_at: new Date().toISOString(),
      approval_note: note || null,
    })
    .eq("id", spotlight.id);
  if (error) {
    console.error("[spotlight approve] failed:", error);
    return NextResponse.json({ error: "Failed to approve." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
