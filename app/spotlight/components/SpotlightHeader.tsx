import Link from "next/link";
import { shade } from "@/lib/color";
import { pokemonSlug } from "@/lib/primaryCardImage";
import SpotlightBanner from "./SpotlightBanner";
import type {
  SpotlightBannerLayout,
  SpotlightCardRef,
  SpotlightPokemonRef,
} from "../types";

const SPRITE_BASE = "https://r2.limitlesstcg.net/pokemon/gen9";

interface Props {
  displayName: string;
  username: string;
  avatarUrl: string | null;
  headline: string | null;
  /** Three energy-type colors, ordered: favorite Pokémon, favorite in
   *  collection, favorite to play. Nulls collapse out — the gradient
   *  shows however many we have. */
  accentColors: (string | null)[];
  layout: SpotlightBannerLayout;
  /** When true, items in the banner that support it can be dragged +
   *  resized. The card fans and the pinned Pokémon sprite are always
   *  static; only the uploaded user image responds to editable. */
  editable: boolean;
  spotlightId: string;
  favoritePokemon: SpotlightPokemonRef | null;
  /** Up to 3 cards per side; rendered as fans on the left (collection)
   *  and right (play) of the banner. */
  favoriteCollectionCards: SpotlightCardRef[];
  favoriteFormatCards: SpotlightCardRef[];
  userImageUrl: string | null;
  /** Slot rendered inside the bio column, immediately under the
   *  headline. The spotlight page uses this for the admin pill
   *  (Draft / Reset / Edit / Publish) when the viewer is an admin. */
  headerAction?: React.ReactNode;
}

const COLORLESS = "#B0A89E";

export default function SpotlightHeader({
  displayName,
  username,
  avatarUrl,
  headline,
  accentColors,
  layout,
  editable,
  spotlightId,
  favoritePokemon,
  favoriteCollectionCards,
  favoriteFormatCards,
  userImageUrl,
  headerAction,
}: Props) {
  const stops = accentColors.filter((c): c is string => !!c);
  const usable = stops.length > 0 ? stops : [COLORLESS, COLORLESS, COLORLESS];

  const avatarTop = usable[0];
  const avatarGradient = `linear-gradient(180deg, ${avatarTop} 0%, ${shade(
    avatarTop,
    -22,
  )} 100%)`;

  // First letter of each of the first two whitespace-separated words.
  // "Eevee Echo" → "EE"; "Dexter" → "D"; empty → "?". Falling back to
  // initials lets the avatar carry more identity for two-name players.
  const monogram = (() => {
    const words = displayName.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return "?";
    if (words.length === 1) return words[0].charAt(0).toUpperCase();
    return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
  })();

  return (
    <header className="flex-shrink-0">
      <SpotlightBanner
        accentColors={accentColors}
        layout={layout}
        editable={editable}
        spotlightId={spotlightId}
        favoriteCollectionCards={favoriteCollectionCards}
        favoriteFormatCards={favoriteFormatCards}
        userImageUrl={userImageUrl}
      />

      {/* Bio block — trainer avatar overlaps banner via negative margin.
          Mobile size is 30% smaller than desktop (128 → ~90 px) and the
          negative top margin scales with it so the avatar continues to
          overlap roughly half over the banner at both breakpoints.
          Fallback order inside the circle: user avatar → favorite
          Pokémon sprite (now lives here instead of pinned to the banner
          corner) → monogram. */}
      <div className="mx-auto max-w-2xl px-6">
        <div className="flex items-end justify-between gap-3 -mt-11 sm:-mt-20">
          <div
            className="relative z-10 rounded-full ring-4 ring-bg flex items-center justify-center overflow-hidden shrink-0 w-[90px] h-[90px] sm:w-32 sm:h-32"
            style={{ background: avatarGradient }}
          >
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt={displayName}
                className="w-full h-full object-cover"
              />
            ) : favoritePokemon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${SPRITE_BASE}/${pokemonSlug(favoritePokemon.name)}.png`}
                alt={favoritePokemon.name}
                className="w-[78%] h-[78%] object-contain drop-shadow-sm"
              />
            ) : (
              <span className="text-4xl sm:text-5xl font-black text-white drop-shadow-sm">
                {monogram}
              </span>
            )}
          </div>
        </div>

        <div className="mt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-accent mb-1">
            Trainer Spotlight
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary leading-tight">
            {displayName}
          </h1>
          <Link
            href={`/u/${username}`}
            className="inline-block text-sm text-text-muted hover:text-accent mt-0.5"
          >
            @{username}
          </Link>
          {headline && (
            <p className="text-sm sm:text-base font-semibold italic text-text-secondary mt-3 leading-relaxed">
              {headline}
            </p>
          )}
          {headerAction && <div className="mt-4">{headerAction}</div>}
        </div>
      </div>
    </header>
  );
}

