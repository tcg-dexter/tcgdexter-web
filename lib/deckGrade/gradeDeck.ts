import type { AxisResult, DeckGrade, GradeInput } from "./types";
import { PLAY_STYLE_LABEL } from "./types";
import { classifyStyle } from "./classifyStyle";
import {
  scoreEnergy,
  scoreEvolution,
  scoreMeta,
  scorePrize,
  scoreSetup,
  scoreToolbox,
} from "./axes";

function letterFor(total: number): string {
  if (total >= 90) return "S";
  if (total >= 80) return "A";
  if (total >= 68) return "B";
  if (total >= 52) return "C";
  return "D";
}

/**
 * Grade a deck across the capability axes, style-aware. Legality is carried as
 * a separate gate — it is NOT blended into the quality total (a well-built but
 * newly-rotated deck should still read as well-built).
 */
export function gradeDeck(input: GradeInput): DeckGrade {
  const { cards } = input;
  const { style, confidence } = classifyStyle(cards);

  const axes: AxisResult[] = [
    scoreSetup(cards, style),
    scoreEnergy(cards, style),
    scorePrize(cards, style),
    scoreEvolution(cards),
    scoreToolbox(cards, style),
    scoreMeta(input.meta),
  ];

  const scored = axes.filter((a) => a.weight > 0);
  const weightSum = scored.reduce((s, a) => s + a.weight, 0);
  const total =
    weightSum > 0
      ? Math.round(scored.reduce((s, a) => s + a.score * a.weight, 0) / weightSum)
      : 0;

  return {
    style,
    styleLabel: PLAY_STYLE_LABEL[style],
    styleConfidence: Math.round(confidence * 100) / 100,
    total,
    grade: letterFor(total),
    axes,
    legality: input.legality,
  };
}
