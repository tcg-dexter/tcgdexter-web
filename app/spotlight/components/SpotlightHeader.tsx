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
}

const COLORLESS = "#B0A89E";
const SPRITE_BASE = "https://r2.limitlesstcg.net/pokemon/gen9";

// Base footprint as a fraction of banner width.
const USER_IMAGE_BASE_WIDTH_PCT = 28;
const CARD_FAN_WIDTH_PCT = 18; // each card's width within a fan
const POKEMON_CORNER_WIDTH_PCT = 8; // half the prior 16 — per request

// Card fan geometry. The front card (i=0) sits vertical at the side's
// anchor point — closest to the center of the banner. Trailing cards
// shift outward (toward the banner edge) and rotate progressively.
// Steps are unsigned magnitudes; the per-side `sign` multiplier
// (+1 right, −1 left) directs them outward on each side.
//
// Anchors brought in from 20→28% so each fan sits closer to the
// banner center, and rotation magnitudes flipped (mirrored along the
// vertical axis) so the tops of trailing cards now lean inward
// instead of outward.
const FAN_ANCHOR_X_PCT = 28; // left side; right side mirrors to 72
const FAN_ANCHOR_Y_PCT = 55;
const FAN_DX_STEPS_PCT = [0, 5, 10];
const FAN_DY_STEPS_PCT = [0, 1.5, 3];
const FAN_ROTATION_DEG = [0, 10, 18];

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
      <div
        className="relative w-full overflow-hidden h-[calc(34vw-12px)] sm:h-auto sm:aspect-[3/1]"
        style={{ background: bannerGradient }}
      >
        {/* Card fans — left (collection) and right (play). Painted
            back-to-front so the i=0 front card lands on top. */}
        <CardFan cards={favoriteCollectionCards} side="left" />
        <CardFan cards={favoriteFormatCards} side="right" />

        {/* User image — only interactive item in the banner. */}
        {userImageUrl && (
          <SpotlightBannerItem
            spotlightId={spotlightId}
            itemKey="user_image"
            initial={layout.user_image}
            baseWidthPct={USER_IMAGE_BASE_WIDTH_PCT}
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

        {/* Favorite-Pokémon sprite — pinned to the bottom-right
            corner, 50% smaller than the earlier preset. */}
        {favoritePokemon && (
          <div
            className="absolute pointer-events-none"
            style={{
              right: "1.5%",
              bottom: "4%",
              width: `${POKEMON_CORNER_WIDTH_PCT}%`,
            }}
          >
            <PokemonSprite pokemon={favoritePokemon} />
          </div>
        )}
      </div>

      {/* Bio block — trainer avatar overlaps banner via negative margin. */}
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

/**
 * Hand-fan stack of up to 3 cards. Front card is vertical at the side's
 * anchor; trailing cards shift outward and rotate outward in
 * increasing increments. The right side mirrors the left's offsets so
 * both stacks read as opposing hands of cards.
 */
function CardFan({
  cards,
  side,
}: {
  cards: SpotlightCardRef[];
  side: "left" | "right";
}) {
  if (cards.length === 0) return null;
  const sign = side === "left" ? -1 : 1;
  const anchorX = side === "left" ? FAN_ANCHOR_X_PCT : 100 - FAN_ANCHOR_X_PCT;
  const limited = cards.slice(0, 3);

  // Render order: deepest card first so the front (i=0) paints last
  // and lands on top — the natural hand-fan stacking.
  const ordered = limited
    .map((card, i) => ({ card, i }))
    .sort((a, b) => b.i - a.i);

  return (
    <>
      {ordered.map(({ card, i }) => {
        const dx = sign * (FAN_DX_STEPS_PCT[i] ?? 0);
        const dy = FAN_DY_STEPS_PCT[i] ?? 0;
        const rot = sign * (FAN_ROTATION_DEG[i] ?? 0);
        return (
          <div
            key={`${card.set_id}-${card.number}-${i}`}
            className="absolute pointer-events-none"
            style={{
              left: `${anchorX + dx}%`,
              top: `${FAN_ANCHOR_Y_PCT + dy}%`,
              width: `${CARD_FAN_WIDTH_PCT}%`,
              transform: `translate(-50%, -50%) rotate(${rot}deg)`,
              // Trailing cards sit visually behind via z-index; the
              // sort above also ensures correct paint order so the
              // drop shadow doesn't cross over the front card.
              zIndex: 10 - i,
            }}
          >
            <CardArt card={card} />
          </div>
        );
      })}
    </>
  );
}

function CardArt({ card }: { card: SpotlightCardRef }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={cardImageLarge(card.set_id, card.number)}
      alt={card.name}
      draggable={false}
      className="w-full h-auto block rounded-md drop-shadow-lg"
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
