interface Props {
  copyCount: number;
}

/**
 * Deck-profile variant of `app/cards/CardFooterOverlay`. Keeps the gradient
 * fade-to-black but reduces the chrome to a single centered copy-count chip
 * — the rest of the card's identity is already legible from the image.
 */
export default function DeckTileFooter({ copyCount }: Props) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[15%] min-h-[36px] flex items-end justify-center pb-1.5 bg-gradient-to-b from-transparent to-neutral-800 to-80% overflow-hidden">
      <span className="inline-flex items-center justify-center rounded-full bg-white text-black text-[10px] font-bold tabular-nums w-[18px] h-[18px] leading-none">
        {copyCount}
      </span>
    </div>
  );
}
