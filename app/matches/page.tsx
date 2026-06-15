import SectionHeader from "@/app/components/ui/SectionHeader";
import { loadRecentMatches } from "@/lib/recent-matches";
import MatchesClient from "./MatchesClient";

export const revalidate = 60;

export default async function MatchesPage() {
  const matches = await loadRecentMatches(200);

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 pt-[calc(env(safe-area-inset-top)_+_1.68rem)] md:pt-[calc(env(safe-area-inset-top)_+_3rem)] pb-24">
      <div className="mb-6">
        <SectionHeader title="Matches" />
      </div>

      <MatchesClient matches={matches} />
    </main>
  );
}
