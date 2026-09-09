import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  EDITABLE_STATUSES,
  requireInvitedSpotlight,
} from "@/lib/spotlight/onboarding";
import { normalizeSubmission } from "@/app/spotlight/types";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * POST /api/spotlight/onboarding/avatar  (multipart/form-data, field "file")
 *
 * The trainer's raw TCG Live avatar screenshot. Stored at
 * `spotlights/{spotlight_id}/submission-avatar.{ext}` in the public `avatars`
 * bucket and recorded on `submission.avatar_upload_url`.
 *
 * Deliberately a different path and column from the admin uploader's
 * `avatar_image_url`: this is an unedited screenshot, and the admin cuts the
 * subject out before it becomes the banner image. Overwriting the banner
 * image with it would ship the raw screenshot to production.
 *
 * The cap is larger than the profile avatar's 2 MB because a desktop TCG Live
 * screenshot is a full-resolution PNG.
 */
export async function POST(req: Request) {
  const ctx = await requireInvitedSpotlight();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  const { spotlight } = ctx;
  if (!EDITABLE_STATUSES.includes(spotlight.submission_status)) {
    return NextResponse.json(
      { error: "This spotlight can't be edited right now." },
      { status: 409 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json(
      { error: "Screenshot must be a PNG, JPEG, or WebP image." },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Screenshot must be 8 MB or smaller." },
      { status: 400 },
    );
  }

  const ext =
    file.type === "image/png"
      ? "png"
      : file.type === "image/webp"
        ? "webp"
        : "jpg";
  const path = `spotlights/${spotlight.id}/submission-avatar.${ext}`;

  // Service role: the avatars bucket's write policy is scoped to
  // `{user_id}/…` paths, and this one is keyed by spotlight id instead.
  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from("avatars")
    .upload(path, file, {
      contentType: file.type,
      upsert: true,
      cacheControl: "3600",
    });
  if (uploadError) {
    console.error("[spotlight onboarding avatar] upload failed:", uploadError);
    return NextResponse.json({ error: "Failed to upload." }, { status: 500 });
  }

  const { data: urlData } = admin.storage.from("avatars").getPublicUrl(path);
  const url = `${urlData.publicUrl}?v=${Date.now()}`;

  const submission = normalizeSubmission(spotlight.submission);
  const { error } = await admin
    .from("trainer_spotlights")
    .update({ submission: { ...submission, avatar_upload_url: url } })
    .eq("id", spotlight.id);
  if (error) {
    console.error("[spotlight onboarding avatar] save failed:", error);
    return NextResponse.json(
      { error: "Uploaded, but saving the link failed." },
      { status: 500 },
    );
  }

  return NextResponse.json({ avatar_upload_url: url });
}

/** Clears the recorded screenshot. The storage object is left in place — the
 *  next upload overwrites it via the deterministic path. */
export async function DELETE() {
  const ctx = await requireInvitedSpotlight();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  const { spotlight } = ctx;
  if (!EDITABLE_STATUSES.includes(spotlight.submission_status)) {
    return NextResponse.json(
      { error: "This spotlight can't be edited right now." },
      { status: 409 },
    );
  }

  const submission = normalizeSubmission(spotlight.submission);
  const admin = createAdminClient();
  const { error } = await admin
    .from("trainer_spotlights")
    .update({ submission: { ...submission, avatar_upload_url: null } })
    .eq("id", spotlight.id);
  if (error) {
    return NextResponse.json({ error: "Failed to clear." }, { status: 500 });
  }
  return NextResponse.json({ avatar_upload_url: null });
}
