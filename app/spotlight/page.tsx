import { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { shade } from "@/lib/color";
import {
  cardTypesForName,
  cardTypesForSetIdNumber,
  pokemonSlug,
} from "@/lib/primaryCardImage";
import { typeColor } from "@/lib/metaPrimaryCard";
import type { TrainerSpotlightRow } from "./types";

export const metadata: Metadata = {
  title: "Spotlight History — TCG Dexter",
  description:
    "Every Trainer Spotlight TCG Dexter has published — browse the archive.",
};

interface Row extends TrainerSpotlightRow {
  profiles: {
    display_name: string;
    username: string;
    avatar_url: string | null;
  } | null;
}

const COLORLESS = "#B0A89E";
const SPRITE_BASE = "https://r2.limitlesstcg.net/pokemon/gen9";

/** Two-letter monogram (shared shape with SpotlightHeader). */
function monogramFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}

/** Same 3-stop horizontal banner gradient the spotlight detail page
 *  computes — derived from the favorite-Pokémon, first-collection,
 *  and first-play card energy accents. */
function bannerGradientFor(row: TrainerSpotlightRow): {
  cardGradient: string;
  firstAccent: string;
} {
  const firstCollection = row.favorite_collection_cards?.[0] ?? null;
  const firstPlay = row.favorite_format_cards?.[0] ?? null;
  const stops = [
    row.favorite_pokemon
      ? typeColor(cardTypesForName(row.favorite_pokemon.name))
      : null,
    firstCollection
      ? typeColor(
          cardTypesForSetIdNumber(
            firstCollection.set_id,
            firstCollection.number,
            firstCollection.name,
          ),
        )
      : null,
    firstPlay
      ? typeColor(
          cardTypesForSetIdNumber(
            firstPlay.set_id,
            firstPlay.number,
            firstPlay.name,
          ),
        )
      : null,
  ].filter((c): c is string => !!c);
  const usable = stops.length > 0 ? stops : [COLORLESS, COLORLESS, COLORLESS];
  const cardGradient = `linear-gradient(90deg, ${usable
    .map(
      (c, i) =>
        `${c} ${Math.round((i / Math.max(usable.length - 1, 1)) * 100)}%`,
    )
    .join(", ")})`;
  return { cardGradient, firstAccent: usable[0] };
}

export default async function SpotlightIndex() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("trainer_spotlights")
    .select(
      "*, profiles!trainer_spotlights_profile_id_fkey(display_name, username, avatar_url)",
    )
    .eq("is_published", true)
    .order("published_at", { ascending: false });

  const spotlights = (data ?? []) as Row[];

  return (
    <main className="min-h-dvh bg-bg pb-24">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 pt-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-text-primary">
            Spotlight History
          </h1>
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
              const { cardGradient, firstAccent } = bannerGradientFor(s);
              const avatarGradient = `linear-gradient(180deg, ${firstAccent} 0%, ${shade(firstAccent, -22)} 100%)`;
              const monogram = monogramFor(profile.display_name);
              return (
                <li key={s.id}>
                  <Link
                    href={`/spotlight/${s.slug}`}
                    className="relative block aspect-[3/2] rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                    style={{ background: cardGradient }}
                  >
                    {/* Foreground content */}
                    <div className="relative z-10 p-4 flex items-start gap-3">
                      {/* Trainer avatar — mirrors SpotlightHeader. */}
                      <div
                        className="rounded-full ring-2 ring-white/80 flex items-center justify-center overflow-hidden shrink-0 w-14 h-14"
                        style={
                          profile.avatar_url
                            ? undefined
                            : { background: avatarGradient }
                        }
                      >
                        {profile.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={profile.avatar_url}
                            alt={profile.display_name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-xl font-black text-white drop-shadow-sm">
                            {monogram}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1 pr-16">
                        <div className="text-sm font-bold text-white leading-tight truncate drop-shadow-sm">
                          {profile.display_name}
                        </div>
                        <div className="text-xs text-white/80 truncate drop-shadow-sm">
                          @{profile.username}
                        </div>
                        {s.headline && (
                          <p className="text-xs italic font-semibold text-white/90 mt-2 line-clamp-2 drop-shadow-sm">
                            {s.headline}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Favorite Pokémon sprite, pinned bottom-right —
                        mirrors the corner placement in SpotlightHeader. */}
                    {s.favorite_pokemon && (
                      <div
                        className="absolute pointer-events-none"
                        style={{
                          right: "4%",
                          top: "50%",
                          transform: "translateY(-50%)",
                          width: "16.5%",
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`${SPRITE_BASE}/${pokemonSlug(s.favorite_pokemon.name)}.png`}
                          alt={s.favorite_pokemon.name}
                          className="w-full h-auto drop-shadow"
                        />
                      </div>
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
