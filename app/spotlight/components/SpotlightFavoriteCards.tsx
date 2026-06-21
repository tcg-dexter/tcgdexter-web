import { cardImageLarge } from "@/lib/cardImages";
import type { SpotlightCardRef } from "../types";

interface Props {
  cards: SpotlightCardRef[];
}

/**
 * Showcase grid for the "Favorite Cards in {Play,Collection}" sections.
 * Up to 3 cards per row at sm:+; stacks on mobile. Each tile is the card
 * art with an optional caption rendered as vertically-centered text
 * below the image. Empty / missing captions collapse out so a card with
 * no blurb just shows the art.
 */
export default function SpotlightFavoriteCards({ cards }: Props) {
  const limited = cards.slice(0, 3);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
      {limited.map((card, i) => {
        const caption = card.caption?.trim() ?? "";
        return (
          <figure
            key={`${card.set_id}-${card.number}-${i}`}
            className="flex flex-col items-center"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cardImageLarge(card.set_id, card.number)}
              alt={card.name}
              className="w-full max-w-[260px] h-auto rounded-xl drop-shadow-md"
            />
            {caption && (
              <figcaption className="mt-3 max-w-[260px] text-sm text-text-secondary text-center leading-relaxed">
                {caption}
              </figcaption>
            )}
          </figure>
        );
      })}
    </div>
  );
}
