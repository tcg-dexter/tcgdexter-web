import CardAnatomy, { type AnatomyPart } from "./CardAnatomy";
import { getCardById } from "@/lib/cardsIndex";
import { cardImageSmall, cardImageFallbacks } from "@/lib/cardImages";

/**
 * Server wrapper for `<CardAnatomy>`: resolves the printing and its image
 * chain here so `lib/cardsIndex` (a 15MB JSON index) never reaches the client
 * bundle. This is the component the MDX files actually name.
 */
export default function CardAnatomyBlock({
  id,
  parts,
  caption,
}: {
  id: string;
  parts: AnatomyPart[];
  caption?: string;
}) {
  const card = getCardById(id);
  if (!card) {
    return (
      <span className="block my-5 text-center text-xs text-accent">
        Unknown card id: <code>{id}</code>
      </span>
    );
  }

  return (
    <CardAnatomy
      src={cardImageSmall(card.setId, card.number)}
      fallbackSrcs={cardImageFallbacks(card.setId, card.number)}
      name={card.name}
      setName={card.setName}
      number={card.number}
      caption={caption ?? `${card.name} · ${card.ptcgoCode ?? card.setId} ${card.number}`}
      parts={parts}
    />
  );
}
