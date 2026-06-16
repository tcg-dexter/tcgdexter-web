import { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DeckMatClient from "./DeckMatClient";

export const metadata: Metadata = {
  title: "Deck Mat · Admin Tools",
};

export default async function DeckMatPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: me } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle<{ is_admin: boolean }>();
  if (!me?.is_admin) redirect("/");

  return (
    <main className="min-h-dvh bg-bg pb-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-text-primary">Deck Mat</h1>
          <p className="text-sm text-text-secondary mt-1">
            Paste a deck list to see it laid out as fanned card piles —
            one pile per unique card name, with each copy stacked left-to-right.
          </p>
        </header>

        <DeckMatClient />
      </div>
    </main>
  );
}
