import Link from "next/link";
import { shade } from "@/lib/color";
import { cardImageLarge } from "@/lib/cardImages";
import { pokemonSlug } from "@/lib/primaryCardImage";
import SpotlightBannerItem from "./SpotlightBannerItem";
import type {
  SpotlightBannerLayout,
  SpotlightCardRef,
  SpotlightPokemonRef,
} from "../types";

interface Props {
  displayName: string;
  username: string;
  avatarUrl: string | null;
  headline: string | null;
  /** Three energy-type colors, ordered: favorite Pokémon, favorite in
   *  collection, favorite to play. Nulls collapse out — the gradient
   *  shows however many we have. */
  accentColors: (string | null)[];
  /** Per-item placement for the four banner elements. */
  layout: SpotlightBannerLayout;
  /** When true, items in the banner can be dragged + resized. Driven
   *  by the page when ?preview=1 is set and the viewer is admin. */
  editable: boolean;
  /** Used by SpotlightBannerItem to PATCH layout updates. */
  spotlightId: string;
  /** The four media references. Each renders only when present. */
  favoritePokemon: SpotlightPokemonRef | null;
  favoriteCollectionCard: SpotlightCardRef | null;
  favoriteFormatCard: SpotlightCardRef | null;
  userImageUrl: string | null;
}

const COLORLESS = "#B0A89E";
const SPRITE_BASE = "https://r2.limitlesstcg.net/pokemon/gen9";

// Base width as a fraction of banner width per item type, at scale=1.0.
// Tuned so the four items read at roughly equal visual weight even
// though cards are tall (5:7) and the sprite is compact.
const BASE_WIDTHS = {
  collection_card: 16,
  pokemon: 14,
  user_image: 26,
  format_card: 16,
};

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
  favoriteCollectionCard,
  favoriteFormatCard,
  userImageUrl,
}: Props) {
  const stops = accentColors.filter((c): c is string => !!c);
  const usable = stops.length > 0 ? stops : [COLORLESS, COLORLESS, COLORLESS];

  const bannerGradient = `linear-gradient(90deg, ${usable
    .map(
      (c, i) =>
        `${c} ${Math.round((i / Math.max(usable.length - 1, 1)) * 100)}%`,
    )
    .join(", ")})`;

  const avatarTop = usable[0];
  const avatarGradient = `linear-gradient(180deg, ${avatarTop} 0%, ${shade(
    avatarTop,
    -22,
  )} 100%)`;

  const initial = displayName.trim().charAt(0).toUpperCase() || "?";

  return (
    <header className="flex-shrink-0">
      {/* Banner — gradient background plus four positioned media items. */}
      <div
        className="relative w-full overflow-hidden h-[calc(34vw-12px)] sm:h-auto sm:aspect-[3/1]"
        style={{ background: bannerGradient }}
      >
        {favoriteCollectionCard && (
          <SpotlightBannerItem
            spotlightId={spotlightId}
            itemKey="collection_card"
            initial={layout.collection_card}
            baseWidthPct={BASE_WIDTHS.collection_card}
            editable={editable}
          >
            <CardArt card={favoriteCollectionCard} />
          </SpotlightBannerItem>
        )}
        {favoritePokemon && (
          <SpotlightBannerItem
            spotlightId={spotlightId}
            itemKey="pokemon"
            initial={layout.pokemon}
            baseWidthPct={BASE_WIDTHS.pokemon}
            editable={editable}
          >
            <PokemonSprite pokemon={favoritePokemon} />
          </SpotlightBannerItem>
        )}
        {userImageUrl && (
          <SpotlightBannerItem
            spotlightId={spotlightId}
            itemKey="user_image"
            initial={layout.user_image}
            baseWidthPct={BASE_WIDTHS.user_image}
            editable={editable}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={userImageUrl}
              alt=""
              draggable={false}
              className="w-full h-auto block"
            />
          </SpotlightBannerItem>
        )}
        {favoriteFormatCard && (
          <SpotlightBannerItem
            spotlightId={spotlightId}
            itemKey="format_card"
            initial={layout.format_card}
            baseWidthPct={BASE_WIDTHS.format_card}
            editable={editable}
          >
            <CardArt card={favoriteFormatCard} />
          </SpotlightBannerItem>
        )}
      </div>

      {/* Bio block. The trainer avatar overlaps the banner via negative
          margin and stays distinct from the items inside the banner. */}
      <div className="mx-auto max-w-2xl px-6">
        <div className="flex items-end justify-between gap-3 -mt-16 sm:-mt-20">
          <div
            className="relative z-10 rounded-full ring-4 ring-bg flex items-center justify-center overflow-hidden shrink-0"
            style={{
              background: avatarGradient,
              width: "128px",
              height: "128px",
            }}
          >
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt={displayName}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-5xl font-black text-white drop-shadow-sm">
                {initial}
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
            <p className="text-sm sm:text-base text-text-secondary mt-3 leading-relaxed">
              {headline}
            </p>
          )}
        </div>
      </div>
    </header>
  );
}

function CardArt({ card }: { card: SpotlightCardRef }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={cardImageLarge(card.set_id, card.number)}
      alt={card.name}
      draggable={false}
      className="w-full h-auto block rounded-md"
    />
  );
}

function PokemonSprite({ pokemon }: { pokemon: SpotlightPokemonRef }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`${SPRITE_BASE}/${pokemonSlug(pokemon.name)}.png`}
      alt={pokemon.name}
      draggable={false}
      className="w-full h-auto block"
    />
  );
}
