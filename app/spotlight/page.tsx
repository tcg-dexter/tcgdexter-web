import { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { TrainerSpotlightRow } from "./types";

export const metadata: Metadata = {
  title: "Trainer Spotlight — TCG Dexter",
  description: "Featured players from the TCG Dexter community.",
};

interface Row extends TrainerSpotlightRow {
  profiles: {
    display_name: string;
    username: string;
    avatar_url: string | null;
  } | null;
}

export default async function SpotlightIndex() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("trainer_spotlights")
    .select(
      "*, profiles!trainer_spotlights_profile_id_fkey(display_name, username, avatar_url)"
    )
    .eq("is_published", true)
    .order("published_at", { ascending: false });

  const spotlights = (data ?? []) as Row[];

  return (
    <main className="min-h-dvh bg-bg pb-24">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 pt-8">
        <header className="mb-6">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-accent mb-1">
            Community
          </div>
          <h1 className="text-2xl font-bold text-text-primary">
            Trainer Spotlight
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Featured players, their favorite cards, and the decks they love.
          </p>
        </header>

        {spotlights.length === 0 ? (
          <div className="rounded-2xl border border-black/8 bg-white p-8 text-center text-sm text-text-secondary">
            No spotlights yet — check back soon.
          </div>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {spotlights.map((s) => {
              const profile = s.profiles;
              if (!profile) return null;
              return (
                <li key={s.id}>
                  <Link
                    href={`/spotlight/${s.slug}`}
                    className="block rounded-2xl bg-white border border-black/8 shadow-sm p-4 hover:border-accent transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {profile.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={profile.avatar_url}
                          alt={profile.display_name}
                          className="w-12 h-12 rounded-full object-cover border border-black/8"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-[var(--surface)] flex items-center justify-center text-base font-semibold text-text-secondary">
                          {profile.display_name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-text-primary leading-tight truncate">
                          {profile.display_name}
                        </div>
                        <div className="text-xs text-text-muted truncate">
                          @{profile.username}
                        </div>
                      </div>
                    </div>
                    {s.headline && (
                      <p className="text-sm text-text-secondary mt-3 line-clamp-2">
                        {s.headline}
                      </p>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
