interface Props {
  deckSize: number;
  basicCount: number;
}

/**
 * Probability the opening 7-card hand contains zero Basic Pokémon
 * (the condition that forces a mulligan). Hypergeometric:
 *   P = Π (i=0..6) (N - B - i) / (N - i)
 * where N = deck size, B = number of Basic Pokémon in the deck.
 */
function mulliganProbability(deckSize: number, basicCount: number): number {
  if (deckSize < 7) return 0;
  if (basicCount <= 0) return 1;
  if (deckSize - basicCount < 7) return 0;
  let p = 1;
  for (let i = 0; i < 7; i++) {
    p *= (deckSize - basicCount - i) / (deckSize - i);
  }
  return p;
}

export default function DeckMulliganModule({ deckSize, basicCount }: Props) {
  if (deckSize <= 0) return null;

  const prob = mulliganProbability(deckSize, basicCount);
  const pct = prob * 100;
  // One decimal under 10% so very-low odds don't all collapse to "0%".
  const label =
    pct >= 10 ? `${pct.toFixed(0)}%` : pct >= 0.1 ? `${pct.toFixed(1)}%` : "<0.1%";

  const cardClass =
    "rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm p-5";

  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Mulligan Risk</h2>
        <span className="text-lg font-bold text-text-primary">{label}</span>
      </div>
    </div>
  );
}
