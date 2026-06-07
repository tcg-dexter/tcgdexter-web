import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { TrainerSpotlightRow } from "@/app/spotlight/types";
import EditSpotlightForm from "./EditSpotlightForm";

interface DeckOption {
  id: string;
  name: string;
}

export default async function EditSpotlight({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle<{ is_admin: boolean }>();
  if (!me?.is_admin) redirect("/");

  const { data: spotlight } = await supabase
    .from("trainer_spotlights")
    .select("*")
    .eq("id", id)
    .maybeSingle<TrainerSpotlightRow>();
  if (!spotlight) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, username")
    .eq("id", spotlight.profile_id)
    .maybeSingle<{ display_name: string; username: string }>();

  const { data: decks } = await supabase
    .from("saved_decks")
    .select("id, name")
    .eq("user_id", spotlight.profile_id)
    .order("updated_at", { ascending: false });

  return (
    <main className="min-h-dvh bg-bg pb-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 pt-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-text-primary">
            Edit Spotlight
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            {profile?.display_name} <span className="text-text-muted">@{profile?.username}</span>
          </p>
        </header>
        <EditSpotlightForm
          spotlight={spotlight}
          deckOptions={(decks ?? []) as DeckOption[]}
        />
      </div>
    </main>
  );
}
