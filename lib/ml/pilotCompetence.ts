// Can the simulator's AI actually PILOT this deck?
//
// W5 measures whether simulated archetype win rates match the real meta. They
// don't, and the reason is now well established: both seats share one pilot,
// that pilot is good at "attach energy and swing" decks and bad at engine
// decks, so the meta takes the shape of the AI rather than the shape of the
// format. Cynthia's Garchomp simulates at 82% while being 0.7% of the real
// field; N's Zoroark simulates at 28% against a real 53.6%.
//
// That bias lands in FULL on absolute cross-archetype win rates. It largely
// CANCELS on a paired comparison — same archetype, same pilot, same field,
// one card changed — because it sits on both arms. Which matters, because
// swap advice ("cut this, play that") only needs the delta, and deck grading
// is the thing that needs the absolute number.
//
// Measured, removing each deck's headline attacker and re-running against the
// field on two independent seeds:
//
//     Dragapult           -28.1 / -21.9     consistent
//     Cynthia's Garchomp  -17.7 / -19.8     consistent
//     Mega Lucario         -9.4 / -15.6     consistent
//     N's Zoroark          -5.2 / +13.5     INCONSISTENT
//
// Zoroark is exactly the deck the AI cannot pilot: it never leverages the
// card, so deleting it costs nothing and can even help by freeing a slot.
//
// So the honest product rule is not "trust the sim" or "don't" — it is: gut
// the deck and check that the simulator NOTICES. A pilot that cannot tell
// that removing your best card made your deck worse has no business advising
// you on swaps. This module is that check.

import type { SimOptions } from "../engine/sim/rollout";

/** How much worse a gutted deck must perform, in win-rate points, before we
 *  believe the pilot understands the deck. Removing a deck's headline
 *  attacker is a catastrophic change; anything short of a clear drop means
 *  the AI was not using the card. */
export const COMPETENCE_DROP_POINTS = 5;

export interface CompetenceProbe {
  /** Win rate vs the field with the real list. */
  base: number;
  /** Win rate vs the field with the key card removed. */
  gutted: number;
  /** gutted - base, in win-rate POINTS (negative = the sim noticed). */
  deltaPoints: number;
}

export interface CompetenceVerdict {
  /** Per-seed probes. At least two, or consistency is unmeasurable. */
  probes: CompetenceProbe[];
  /** Mean delta across seeds, in points. */
  meanDeltaPoints: number;
  /** Did EVERY seed agree that gutting the deck hurt? */
  consistent: boolean;
  /** The verdict: may we offer swap advice for this deck? */
  competent: boolean;
  reason: string;
}

/** Judge a set of probes. Pure — the simulation happens in the caller, so
 *  this is testable without running thousands of games. */
export function judgeCompetence(probes: CompetenceProbe[]): CompetenceVerdict {
  if (probes.length < 2) {
    return {
      probes,
      meanDeltaPoints: probes[0]?.deltaPoints ?? 0,
      consistent: false,
      competent: false,
      reason: "need at least two seeds to tell a real effect from noise",
    };
  }
  const mean = probes.reduce((s, p) => s + p.deltaPoints, 0) / probes.length;
  // EVERY seed must agree on the sign. A mean that survives one seed pointing
  // the other way is the Zoroark case (-5.2 / +13.5 averages to +4.2 and
  // would otherwise read as a confident, and completely wrong, "the card
  // hurts you"). Sign agreement is the whole point of running two seeds.
  const consistent = probes.every((p) => p.deltaPoints <= 0);
  const bigEnough = mean <= -COMPETENCE_DROP_POINTS;
  const competent = consistent && bigEnough;
  return {
    probes,
    meanDeltaPoints: mean,
    consistent,
    competent,
    reason: competent
      ? `removing the key card cost ${(-mean).toFixed(1)} points on every seed — the pilot is using it`
      : !consistent
        ? "seeds disagree on whether the key card even helps — the pilot is not using it"
        : `removing the key card cost only ${(-mean).toFixed(1)} points — below the ${COMPETENCE_DROP_POINTS}-point bar`,
  };
}

/** Replace every copy of `cardName` with a filler Energy, keeping the deck at
 *  60 cards. Matching is by line PREFIX because deck lines carry set codes
 *  ("4 Dragapult ex DRI 130") that vary between lists. */
export function gutDeckList(list: string, cardName: string, filler = "Basic Fighting Energy"): string {
  let removed = 0;
  const out = list
    .split("\n")
    .map((line) => {
      const m = line.match(/^\s*(\d+)\s+(.*?)\s*$/);
      if (!m) return line;
      if (!m[2].startsWith(cardName)) return line;
      removed += Number(m[1]);
      return `${m[1]} ${filler}`;
    })
    .join("\n");
  return removed > 0 ? out : list;
}

/** The card a deck most depends on — the one whose removal the pilot could
 *  not possibly miss if it understood the deck.
 *
 *  Prefers a card the ARCHETYPE is named after, falling back to the highest-HP
 *  attacker. Highest-HP alone is not good enough: it picked Fezandipiti ex
 *  (210 HP, a generic tech card in many lists) as Alakazam's key card over
 *  Alakazam itself (140 HP), which tests the wrong thing entirely — a deck can
 *  survive losing its tech and still be crippled by losing its engine. */
export function headlineCard(
  list: string,
  hp: (name: string) => number | null,
  archetypeName?: string,
): string | null {
  const candidates: { name: string; hp: number }[] = [];
  for (const line of list.split("\n")) {
    const m = line.match(/^\s*\d+\s+(.*?)\s*$/);
    if (!m) continue;
    // Strip a trailing set code + number ("Dragapult ex DRI 130").
    const name = m[1].replace(/\s+[A-Z]{2,4}\s+\d+[a-z]?$/, "");
    const h = hp(name);
    if (h !== null) candidates.push({ name, hp: h });
  }
  if (candidates.length === 0) return null;
  if (archetypeName) {
    // "Cynthia's Garchomp" -> match "Cynthia's Garchomp ex"; "Alakazam" ->
    // "Alakazam". Take the beefiest card sharing the archetype's name.
    const named = candidates
      .filter((c) => c.name.startsWith(archetypeName) || archetypeName.startsWith(c.name))
      .sort((a, b) => b.hp - a.hp);
    if (named.length > 0) return named[0].name;
  }
  return candidates.sort((a, b) => b.hp - a.hp)[0].name;
}

export type { SimOptions };
