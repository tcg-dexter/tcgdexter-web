import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateDisplayName } from "@/lib/display-name-rules";
import { validateUsername } from "@/lib/username-rules";

const BIO_MAX_LENGTH = 240;

/**
 * GET /api/profile
 *
 * Returns the authenticated user's editable profile fields. Used by client
 * components that can't reliably query Supabase directly due to RLS policies.
 */
export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, username, is_public, avatar_url, bio")
    .eq("id", user.id)
    .single();

  return NextResponse.json({
    display_name: profile?.display_name ?? null,
    username: profile?.username ?? null,
    is_public: profile?.is_public ?? false,
    avatar_url: profile?.avatar_url ?? null,
    bio: profile?.bio ?? null,
  });
}

/**
 * PATCH /api/profile
 *
 * Updates the authenticated user's profile. Each field is independently
 * optional — the client may send any subset.
 *   - display_name: 2–30 chars, alphanumeric + spaces/hyphens/underscores,
 *     blocklisted, unique case-insensitively
 *   - is_public:    boolean — opts the profile in to public surfaces
 *   - avatar_url:   string | null — set after a successful avatar upload, or
 *     null to clear
 *   - bio:          string | null — up to 240 chars; trimmed; null clears
 *
 * Returns the updated fields on success.
 */
export async function PATCH(req: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  let body: {
    display_name?: string;
    username?: string;
    is_public?: boolean;
    avatar_url?: string | null;
    bio?: string | null;
    banner_accent?: string | null;
    team_of_6?: (string | null)[] | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  // ── display_name ──────────────────────────────────────────────
  if (typeof body.display_name === "string") {
    const displayName = body.display_name.trim();
    if (!displayName) {
      return NextResponse.json(
        { error: "Display name is required." },
        { status: 400 }
      );
    }

    const validation = validateDisplayName(displayName);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Friendly uniqueness check; the unique index is the real guard.
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .ilike("display_name", displayName)
      .maybeSingle();

    if (existing && existing.id !== user.id) {
      return NextResponse.json(
        { error: "That display name is already taken." },
        { status: 409 }
      );
    }

    updates.display_name = displayName;
  }

  // ── username (immutable, set-once) ────────────────────────────
  if (typeof body.username === "string") {
    const username = body.username.trim().toLowerCase();
    const validation = validateUsername(username);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Reject if already set — username is immutable.
    const { data: current } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .single();
    if (current?.username) {
      return NextResponse.json(
        { error: "Username can only be set once." },
        { status: 409 },
      );
    }

    // Friendly uniqueness check; the unique index is the real guard.
    const { data: taken } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();
    if (taken && taken.id !== user.id) {
      return NextResponse.json(
        { error: "That username is already taken." },
        { status: 409 },
      );
    }

    updates.username = username;
  }

  // ── is_public ─────────────────────────────────────────────────
  if (typeof body.is_public === "boolean") {
    updates.is_public = body.is_public;
  }

  // ── avatar_url ────────────────────────────────────────────────
  // Accept the public URL the client received from /api/profile/avatar,
  // or null to clear. We don't validate the URL itself — the storage RLS
  // policy already restricts who can write into the avatars bucket.
  if (body.avatar_url === null || typeof body.avatar_url === "string") {
    updates.avatar_url = body.avatar_url;
  }

  // ── banner_accent ─────────────────────────────────────────────
  // Per-user banner color. Null clears (falls back to brand gradient);
  // a string must be one of the 11 energy keys mirrored in the
  // profiles_banner_accent_check constraint.
  if (body.banner_accent === null) {
    updates.banner_accent = null;
  } else if (typeof body.banner_accent === "string") {
    const ACCENT_KEYS = new Set([
      "Fire",
      "Water",
      "Grass",
      "Lightning",
      "Psychic",
      "Fighting",
      "Darkness",
      "Metal",
      "Dragon",
      "Fairy",
      "Colorless",
    ]);
    if (!ACCENT_KEYS.has(body.banner_accent)) {
      return NextResponse.json(
        { error: "Invalid banner color." },
        { status: 400 }
      );
    }
    updates.banner_accent = body.banner_accent;
  }

  // ── team_of_6 ─────────────────────────────────────────────────
  // 6-slot Pokémon roster for the banner. Each entry is a short
  // display name (e.g. "Pikachu") or null for an empty slot. We don't
  // validate against the names list — that's a build-time artifact and
  // the column check constraint already caps array length at 6.
  if (body.team_of_6 === null) {
    updates.team_of_6 = null;
  } else if (Array.isArray(body.team_of_6)) {
    if (body.team_of_6.length > 6) {
      return NextResponse.json(
        { error: "Team of 6 cannot exceed 6 slots." },
        { status: 400 }
      );
    }
    const cleaned: (string | null)[] = [];
    for (const slot of body.team_of_6) {
      if (slot === null || slot === undefined || slot === "") {
        cleaned.push(null);
      } else if (typeof slot === "string" && slot.length <= 60) {
        cleaned.push(slot);
      } else {
        return NextResponse.json(
          { error: "Invalid team slot." },
          { status: 400 }
        );
      }
    }
    updates.team_of_6 = cleaned;
  }

  // ── bio ───────────────────────────────────────────────────────
  if (body.bio === null) {
    updates.bio = null;
  } else if (typeof body.bio === "string") {
    const bio = body.bio.trim();
    if (bio.length > BIO_MAX_LENGTH) {
      return NextResponse.json(
        { error: `Bio must be ${BIO_MAX_LENGTH} characters or fewer.` },
        { status: 400 }
      );
    }
    updates.bio = bio.length === 0 ? null : bio;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", user.id);

  if (error) {
    if (error.code === "23505") {
      // Could be either display_name or username — message reads naturally
      // for both.
      return NextResponse.json(
        { error: "That handle is already taken." },
        { status: 409 }
      );
    }
    console.error("[profile] update failed:", error);
    return NextResponse.json(
      { error: "Failed to update profile." },
      { status: 500 }
    );
  }

  return NextResponse.json(updates);
}
