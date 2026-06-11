import { cardImageLarge } from "@/lib/cardImages";
import { pokemonSlug } from "@/lib/primaryCardImage";
import SpotlightBannerItem from "./SpotlightBannerItem";
import type {
  SpotlightBannerLayout,
  SpotlightCardRef,
  SpotlightPokemonRef,
} from "../types";

interface Props {
  /** Three energy-type colors, ordered: favorite Pokémon, favorite in
   *  collection, favorite to play. Nulls collapse out. */
  accentColors: (string | null)[];
  layout: SpotlightBannerLayout;
  editable: boolean;
  spotlightId: string;
  favoritePokemon: SpotlightPokemonRef | null;
  favoriteCollectionCards: SpotlightCardRef[];
  favoriteFormatCards: SpotlightCardRef[];
  userImageUrl: string | null;
  /** Tailwind class overrides for the banner box. Defaults to the
   *  spotlight page's responsive size; the home preview supplies its
   *  own (uniform 3:1) sizing. */
  className?: string;
}

const COLORLESS = "#B0A89E";
const SPRITE_BASE = "https://r2.limitlesstcg.net/pokemon/gen9";

const USER_IMAGE_BASE_WIDTH_PCT = 28;
const CARD_FAN_WIDTH_PCT = 18;
const POKEMON_CORNER_WIDTH_PCT = 8;

const FAN_ANCHOR_X_PCT = 35;
const FAN_ANCHOR_Y_PCT = 50;
const FAN_DX_STEPS_PCT = [0, 8.4, 16.8];
const FAN_DY_STEPS_PCT = [0, 1.5, 3];
const FAN_ROTATION_DEG = [4, 8, 12];

const DEFAULT_CLASSNAME =
  "relative w-full overflow-hidden h-[calc(44.88vw-12px)] sm:h-auto sm:aspect-[3/1]";

export default function SpotlightBanner({
  accentColors,
  layout,
  editable,
  spotlightId,
  favoritePokemon,
  favoriteCollectionCards,
  favoriteFormatCards,
  userImageUrl,
  className = DEFAULT_CLASSNAME,
}: Props) {
  const stops = accentColors.filter((c): c is string => !!c);
  const usable = stops.length > 0 ? stops : [COLORLESS, COLORLESS, COLORLESS];

  const bannerGradient = `linear-gradient(90deg, ${usable
    .map(
      (c, i) =>
        `${c} ${Math.round((i / Math.max(usable.length - 1, 1)) * 100)}%`,
    )
    .join(", ")})`;

  return (
    <div className={className} style={{ background: bannerGradient }}>
      <CardFan cards={favoriteCollectionCards} side="left" />
      <CardFan cards={favoriteFormatCards} side="right" />

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
  );
}

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
