import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateDisplayName } from "@/lib/display-name-rules";
import { validateUsername } from "@/lib/username-rules";

const BIO_MAX_LENGTH = 240;
const TEAM_CARDS_MAX = 7;
const TEAM_CARD_NAME_MAX = 60;
const TEAM_CARD_ID_MAX = 20;

interface TeamCardInput {
  name?: unknown;
  set_id?: unknown;
  number?: unknown;
}

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
    .select("display_name, username, is_public, avatar_url, bio, theme_preference")
    .eq("id", user.id)
    .single();

  return NextResponse.json({
    display_name: profile?.display_name ?? null,
    username: profile?.username ?? null,
    is_public: profile?.is_public ?? false,
    avatar_url: profile?.avatar_url ?? null,
    bio: profile?.bio ?? null,
    theme_preference: profile?.theme_preference ?? "light",
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
    team_cards?: (TeamCardInput | null)[] | null;
    theme_preference?: string;
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

  // ── team_cards ────────────────────────────────────────────────
  // 7-slot card roster fanned across the banner. Each entry is null
  // (empty slot) or {name, set_id, number} identifying a specific
  // printing. We don't validate the printing exists in the catalog —
  // the column check constraint caps array length at 7, and a stale
  // reference just fails to resolve an image client-side.
  if (body.team_cards === null) {
    updates.team_cards = null;
  } else if (Array.isArray(body.team_cards)) {
    if (body.team_cards.length > TEAM_CARDS_MAX) {
      return NextResponse.json(
        { error: `Team cannot exceed ${TEAM_CARDS_MAX} slots.` },
        { status: 400 }
      );
    }
    const cleaned: ({ name: string; set_id: string; number: string } | null)[] = [];
    for (const slot of body.team_cards) {
      if (slot === null || slot === undefined) {
        cleaned.push(null);
        continue;
      }
      const { name, set_id, number } = slot;
      if (
        typeof name === "string" &&
        name.length > 0 &&
        name.length <= TEAM_CARD_NAME_MAX &&
        typeof set_id === "string" &&
        set_id.length > 0 &&
        set_id.length <= TEAM_CARD_ID_MAX &&
        typeof number === "string" &&
        number.length > 0 &&
        number.length <= TEAM_CARD_ID_MAX
      ) {
        cleaned.push({ name, set_id, number });
      } else {
        return NextResponse.json(
          { error: "Invalid team card." },
          { status: 400 }
        );
      }
    }
    updates.team_cards = cleaned;
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

  // ── theme_preference ─────────────────────────────────────────────
  if (typeof body.theme_preference === "string") {
    if (!["light", "dark", "system"].includes(body.theme_preference)) {
      return NextResponse.json(
        { error: "Invalid theme preference." },
        { status: 400 }
      );
    }
    updates.theme_preference = body.theme_preference;
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
