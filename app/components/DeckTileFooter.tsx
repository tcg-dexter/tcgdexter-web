interface Props {
  setCode: string | null;
  setId: string;
  number: string;
  setSize: number;
  copyCount: number;
}

function padNumber(n: string): string {
  const m = n.match(/^(\d+)(.*)$/);
  if (!m) return n;
  return m[1].padStart(3, "0") + m[2];
}

/**
 * Deck-profile variant of `app/cards/CardFooterOverlay`. Same gradient + set
 * code badge treatment; the right slot shows the deck's copy count for that
 * card (×N) instead of the catalog's market price.
 */
export default function DeckTileFooter({
  setCode,
  setId,
  number,
  setSize,
  copyCount,
}: Props) {
  const code = (setCode || setId || "").toUpperCase();
  const num = padNumber(number);
  const numberLabel = setSize > 0 ? `${num}/${setSize}` : num;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[15%] min-h-[36px] flex items-end justify-between gap-2 px-2 pb-[5px] bg-gradient-to-b from-transparent to-black to-80% text-white text-[12.5px] font-semibold leading-none tabular-nums overflow-hidden">
      <span className="flex items-center gap-1 min-w-0">
        {code && (
          <span className="truncate rounded-md border border-white/70 px-1.5 py-0.5">
            {code}
          </span>
        )}
        <span className="truncate">{numberLabel}</span>
      </span>
      <span className="truncate mb-[3px]">&times;{copyCount}</span>
    </div>
  );
}
