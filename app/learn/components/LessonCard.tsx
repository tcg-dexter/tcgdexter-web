import CardImage from "@/app/cards/CardImage";
import { getCardById } from "@/lib/cardsIndex";
import { cardImageSmall, cardImageFallbacks } from "@/lib/cardImages";

const WIDTH = {
  sm: "max-w-[150px]",
  md: "max-w-[220px]",
  lg: "max-w-[300px]",
} as const;

export type LessonCardProps = {
  /** Card index id — `${setId}-${number}`, e.g. "sv9-175". */
  id: string;
  size?: keyof typeof WIDTH;
  /** Short line under the card. Defaults to "Name · SET number". */
  caption?: string | false;
};

/**
 * A real card, resolved from the bundled index rather than a hardcoded URL.
 *
 * The lessons used to inline `https://images.pokemontcg.io/...` addresses,
 * which silently broke for any set that host doesn't index — the Mega
 * Evolution sets route to Limitless and scrydex instead (see
 * `SET_IMAGE_SOURCES` in lib/cardImages.ts). Going through the resolver means
 * a lesson can name any Standard printing and get the right CDN, with
 * `CardImage`'s fallback chain and placeholder behind it.
 */
export default function LessonCard({ id, size = "md", caption }: LessonCardProps) {
  const card = getCardById(id);
  if (!card) {
    // Better a visible gap in review than a silently missing illustration.
    // `curriculum.test.ts` asserts every id in the MDX resolves, so this
    // should only ever be seen mid-edit.
    return (
      <span className="block my-5 text-center text-xs text-accent">
        Unknown card id: <code>{id}</code>
      </span>
    );
  }

  const label = caption ?? `${card.name} · ${card.ptcgoCode ?? card.setId} ${card.number}`;

  return (
    <figure className={`my-5 mx-auto ${WIDTH[size]}`}>
      <CardImage
        src={cardImageSmall(card.setId, card.number)}
        fallbackSrcs={cardImageFallbacks(card.setId, card.number)}
        alt={card.name}
        name={card.name}
        setName={card.setName}
        number={card.number}
        className="rounded-lg w-full warm-shadow"
      />
      {label !== false && (
        <figcaption className="mt-2 text-center text-xs text-text-muted">
          {label}
        </figcaption>
      )}
    </figure>
  );
}
