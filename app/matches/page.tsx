import SectionHeader from "@/app/components/ui/SectionHeader";
import { loadRecentMatches } from "@/lib/recent-matches";
import { createClient } from "@/lib/supabase/server";
import MatchesClient from "./MatchesClient";

export const revalidate = 60;

export default async function MatchesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let currentUsername: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .maybeSingle<{ username: string }>();
    currentUsername = profile?.username ?? null;
  }

  const matches = await loadRecentMatches(200);

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 pt-[calc(env(safe-area-inset-top)_+_1.68rem)] md:pt-[calc(env(safe-area-inset-top)_+_3rem)] pb-24">
      <div className="mb-6">
        <SectionHeader title="Matches" />
      </div>

      <MatchesClient matches={matches} currentUsername={currentUsername} />
    </main>
  );
}
