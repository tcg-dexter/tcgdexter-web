import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function MyDeckDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.username) redirect("/settings");

  // Resolve the deck's short_id so the canonical owner URL matches the
  // shareable form. Falls back to the raw id (UUID) if the lookup misses.
  const { data: deck } = await supabase
    .from("saved_decks")
    .select("short_id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  redirect(`/u/${profile.username}/${deck?.short_id ?? id}`);
}
