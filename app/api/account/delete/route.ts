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

  // Storage cleanup — best-effort, logged but not fatal.
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
    // Notifications addressed to the user AND ones the user generated for
    // others (their name is snapshotted into those rows — purge both). Before
    // saved_decks, since deck_liked rows reference saved_deck_id.
    {
      label: "notifications recipient",
      run: () =>
        admin.from("notifications").delete().eq("recipient_user_id", userId),
    },
    {
      label: "notifications actor",
      run: () =>
        admin.from("notifications").delete().eq("actor_user_id", userId),
    },
    // Follows in both directions. Deleting these rows fires the
    // user_follows_count_sync trigger, keeping the surviving other party's
    // follower_count / following_count correct.
    {
      label: "user_follows follower",
      run: () =>
        admin.from("user_follows").delete().eq("follower_user_id", userId),
    },
    {
      label: "user_follows following",
      run: () =>
        admin.from("user_follows").delete().eq("following_user_id", userId),
    },
    {
      label: "saved_decks",
      run: () => admin.from("saved_decks").delete().eq("user_id", userId),
    },
    // list_items cascades via its own FK to lists.id — no separate step needed.
    {
      label: "lists",
      run: () => admin.from("lists").delete().eq("user_id", userId),
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
