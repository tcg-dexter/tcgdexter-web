import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, status: 401, error: "Auth required" };
  const { data: me } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle<{ is_admin: boolean }>();
  if (!me?.is_admin) {
    return { ok: false as const, status: 403, error: "Forbidden" };
  }
  return { ok: true as const };
}

/**
 * POST /api/admin/spotlight/[id]/avatar  (multipart/form-data, field "file")
 *
 * Uploads a foreground image (typically the trainer's TCG Live avatar)
 * for the spotlight. Stored in the existing `avatars` bucket under
 * `spotlights/{spotlight_id}/avatar.{ext}` via the service-role client
 * so we don't need separate storage policies for admin uploads.
 *
 * On success returns the new public URL and writes it back to
 * trainer_spotlights.avatar_image_url. Adds a cache-buster so the
 * browser picks up replacements immediately.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const gate = await requireAdmin();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
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
      { error: "Image must be PNG, JPEG, or WebP." },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Image must be 4 MB or smaller." },
      { status: 400 },
    );
  }

  const ext =
    file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `spotlights/${id}/avatar.${ext}`;

  const admin = createAdminClient();

  const { error: uploadError } = await admin.storage
    .from("avatars")
    .upload(path, file, {
      contentType: file.type,
      upsert: true,
      cacheControl: "3600",
    });
  if (uploadError) {
    console.error("[spotlight-avatar] upload failed:", uploadError);
    return NextResponse.json(
      { error: "Failed to upload image." },
      { status: 500 },
    );
  }

  const { data: urlData } = admin.storage.from("avatars").getPublicUrl(path);
  const avatarUrl = `${urlData.publicUrl}?v=${Date.now()}`;

  const { error: rowError } = await admin
    .from("trainer_spotlights")
    .update({ avatar_image_url: avatarUrl })
    .eq("id", id);
  if (rowError) {
    console.error("[spotlight-avatar] row update failed:", rowError);
    return NextResponse.json(
      { error: "Uploaded but failed to persist URL." },
      { status: 500 },
    );
  }

  return NextResponse.json({ avatar_image_url: avatarUrl });
}

/** DELETE /api/admin/spotlight/[id]/avatar — clears the column. Leaves
 *  the storage object in place so a subsequent upload to the same path
 *  cleanly overwrites it. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const gate = await requireAdmin();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("trainer_spotlights")
    .update({ avatar_image_url: null })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ avatar_image_url: null });
}
