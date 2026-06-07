import { cardImageLarge } from "@/lib/cardImages";
import type { SpotlightCardRef } from "../types";

interface Props {
  label: string;
  card: SpotlightCardRef | null;
}

export default function SpotlightCardTile({ label, card }: Props) {
  return (
    <div className="rounded-2xl border border-black/8 bg-white p-4 shadow-sm flex flex-col items-center text-center">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-3">
        {label}
      </div>
      {card ? (
        <>
          <div className="w-full aspect-[5/7] rounded-lg overflow-hidden bg-[var(--surface)] flex items-center justify-center mb-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cardImageLarge(card.set_id, card.number)}
              alt={card.name}
              className="w-full h-full object-contain"
              loading="lazy"
            />
          </div>
          <div className="text-sm font-semibold text-text-primary leading-tight">
            {card.name}
          </div>
          <div className="text-[11px] text-text-muted mt-0.5">
            {card.set_id.toUpperCase()} · {card.number}
          </div>
        </>
      ) : (
        <div className="w-full aspect-[5/7] rounded-lg bg-[var(--surface)] flex items-center justify-center text-xs text-text-muted">
          Not set
        </div>
      )}
    </div>
  );
}
