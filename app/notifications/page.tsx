import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import NotificationList from "./NotificationList";
import type { NotificationRow } from "@/lib/notifications/notify";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Notifications — TCG Dexter",
};

export default async function NotificationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  // Viewer's own handle — used to build links to their decks/profile (the
  // recipient is always the deck owner, so their username resolves the
  // canonical /u/[username]/[shortId] deck URL).
  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();

  const { data } = await supabase
    .from("notifications")
    .select("*")
    .eq("recipient_user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  const notifications = (data ?? []) as NotificationRow[];

  // Which rows were unread at render time — captured BEFORE we mark them read
  // so the list can still highlight what was new.
  const unreadIds = new Set(
    notifications.filter((n) => n.read_at === null).map((n) => n.id),
  );

  // Mark everything read (clears the nav bell on the next navigation). Runs
  // under the recipient's session, permitted by the update RLS policy.
  if (unreadIds.size > 0) {
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_user_id", user.id)
      .is("read_at", null);
  }

  return (
    <main className="mx-auto max-w-2xl px-4 sm:px-6 pt-[calc(env(safe-area-inset-top)_+_1.68rem)] md:pt-[calc(env(safe-area-inset-top)_+_3rem)] pb-24">
      <h1 className="text-3xl font-semibold tracking-tight text-text-primary mb-6">
        Notifications
      </h1>
      <NotificationList
        notifications={notifications}
        unreadIds={unreadIds}
        viewerUsername={profile?.username ?? null}
      />
    </main>
  );
}
