import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/account/delete
 *   body: { confirmation: string }  — must be exactly "DELETE"
 *
 * Permanently deletes the caller's account and all associated data. Runs
 * as a sequence of explicit, child-before-parent deletes via the admin
 * client (rather than relying on FK cascade, since several base tables'
 * ON DELETE behavior predates this codebase's tracked migrations and is
 * unverified) followed by the Supabase Admin API call that removes the
 * auth.users row itself. Steps before that final call are safe to retry
 * on failure; the auth.users deletion is the point of no return.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  let body: { confirmation?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.confirmation !== "DELETE") {
    return NextResponse.json(
      { error: "Confirmation text did not match." },
      { status: 400 }
    );
  }

  const userId = user.id;
  const admin = createAdminClient();

  // Storage cleanup — best-effort, logged but not fatal. Must run before
  // the row deletes below, since deleting `profiles` cascades away the
  // shared_matches/match_evidence rows we're reading paths from here.
  const { data: evidenceRows, error: evidenceReadError } = await admin
    .from("match_evidence")
    .select("image_path")
    .eq("submitted_by_user_id", userId);
  if (evidenceReadError) {
    console.error(
      "[account-delete] failed to read match_evidence paths:",
      evidenceReadError
    );
  } else if (evidenceRows && evidenceRows.length > 0) {
    const paths = evidenceRows
      .map((r) => r.image_path)
      .filter((p): p is string => typeof p === "string" && p.length > 0);
    if (paths.length > 0) {
      const { error: removeEvidenceError } = await admin.storage
        .from("match-evidence")
        .remove(paths);
      if (removeEvidenceError) {
        console.error(
          "[account-delete] failed to remove match-evidence objects:",
          removeEvidenceError
        );
      }
    }
  }

  const { data: avatarFiles, error: avatarListError } = await admin.storage
    .from("avatars")
    .list(userId);
  if (avatarListError) {
    console.error(
      "[account-delete] failed to list avatar files:",
      avatarListError
    );
  } else if (avatarFiles && avatarFiles.length > 0) {
    const paths = avatarFiles.map((f) => `${userId}/${f.name}`);
    const { error: removeAvatarError } = await admin.storage
      .from("avatars")
      .remove(paths);
    if (removeAvatarError) {
      console.error(
        "[account-delete] failed to remove avatar objects:",
        removeAvatarError
      );
    }
  }

  // Explicit row deletes, child-before-parent. Nothing irreversible has
  // happened yet at this point, so any failure here is safe to report and
  // let the user retry.
  const steps: Array<{ label: string; run: () => PromiseLike<{ error: unknown }> }> = [
    {
      label: "match_actions",
      run: () => admin.from("match_actions").delete().eq("user_id", userId),
    },
    {
      label: "match_turns",
      run: () => admin.from("match_turns").delete().eq("user_id", userId),
    },
    {
      label: "user_card_collection",
      run: () =>
        admin.from("user_card_collection").delete().eq("user_id", userId),
    },
    {
      label: "analysis_submissions anonymize",
      run: () =>
        admin
          .from("analysis_submissions")
          .update({ user_id: null })
          .eq("user_id", userId),
    },
    {
      label: "matches opponent_user_id clear",
      run: () =>
        admin
          .from("matches")
          .update({ opponent_user_id: null })
          .eq("opponent_user_id", userId),
    },
    {
      label: "matches",
      run: () => admin.from("matches").delete().eq("user_id", userId),
    },
    {
      label: "saved_decks",
      run: () => admin.from("saved_decks").delete().eq("user_id", userId),
    },
    {
      label: "deck_shares",
      run: () => admin.from("deck_shares").delete().eq("user_id", userId),
    },
    {
      label: "price_alerts",
      run: () => admin.from("price_alerts").delete().eq("user_id", userId),
    },
  ];

  for (const step of steps) {
    const { error } = await step.run();
    if (error) {
      console.error(`[account-delete] step "${step.label}" failed:`, error);
      return NextResponse.json(
        { error: "Failed to delete account data. Please try again or contact support." },
        { status: 500 }
      );
    }
  }

  const { error: profileError } = await admin
    .from("profiles")
    .delete()
    .eq("id", userId);
  if (profileError) {
    console.error("[account-delete] profile delete failed:", profileError);
    return NextResponse.json(
      { error: "Failed to delete account data. Please try again or contact support." },
      { status: 500 }
    );
  }

  // Point of no return.
  const { error: authDeleteError } = await admin.auth.admin.deleteUser(userId);
  if (authDeleteError) {
    console.error(
      "[account-delete] CRITICAL: profile removed but auth.users delete failed:",
      { userId, error: authDeleteError }
    );
    return NextResponse.json(
      {
        error:
          "Your account data was removed, but we hit an error finishing the process. Please contact feedback@tcgdexter.com.",
      },
      { status: 500 }
    );
  }

  console.info("[account-delete] deleted", { userId });

  return NextResponse.json({ success: true });
}
