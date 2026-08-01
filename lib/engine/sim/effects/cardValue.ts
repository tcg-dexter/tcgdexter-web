// How much is it worth pulling a given card out of a hidden zone?
//
// Lives low in the graph because three different layers need it and none of
// them can import the others: the policies rank alternative search PICKS,
// and the runtime's `auto` chooser has to pick a card with no policy in
// sight (runtime -> policy -> attacks -> runtime would cycle).

import { lookupCard } from "../../catalog";
import { riderDamageEstimate } from "./cards";

/** Ranking rationale: completing an evolution line already on the board beats
 *  everything — that card is dead in the deck and live in hand, and it
 *  converts energy already invested in the pre-evolution. Then real attackers
 *  by how hard they actually hit, then Energy, then generic Trainers. */
export function searchTargetValue(name: string, inPlayNames: ReadonlySet<string>): number {
  const card = lookupCard(name);
  if (!card) return 0;
  if (card.supertype === "Energy") return 25;
  if (card.supertype === "Trainer") return 20;
  // Printed damage alone scores an attack that prints "" at zero — the same
  // blindness v18 and the planner fix addressed. It bites hardest here: N's
  // Zoroark ex's Night Joker prints nothing and is the deck's whole reason to
  // exist, so a search would rank it below a vanilla basic.
  const ceiling = Math.max(
    0,
    ...(card.attacks ?? []).map(
      (a) => (parseInt(a.damage, 10) || 0) + riderDamageEstimate(name, a.name),
    ),
  );
  // Dominates raw damage rather than merely competing with it (this started
  // at 200, i.e. less than a big attacker's printed number).
  const evolvesInPlay = card.evolves_from && inPlayNames.has(card.evolves_from) ? 1000 : 0;
  return ceiling + evolvesInPlay;
}
