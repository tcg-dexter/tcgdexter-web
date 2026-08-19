import {
  cardImageUrlForName,
  cardTypesForName,
  findPokemonNameInText,
  headlineVariantForName,
  highestEvolutionForName,
} from "@/lib/primaryCardImage";
import { metaArchetypeCard } from "@/lib/metaArchetypeCards";
import { typeColor } from "@/lib/metaPrimaryCard";

export interface OpponentHeroCard {
  /** The Pokémon name the image/color were resolved from. */
  name: string;
  imageUrl: string;
  color: string;
}

/**
 * Resolves which Pokémon "fronts" an opponent's deck for a match — the
 * single source of truth shared by the /matches preview cards
 * (lib/recent-matches.ts) and the /battles/[id] banner
 * (app/battles/[id]/page.tsx) so the two surfaces can never disagree about
 * the same match.
 *
 * A user-recognized archetype is the strongest signal available and is
 * tried first: it names the deck the player actually identified, rather
 * than whichever single attacker happened to swing the most or land the
 * last hit in one particular game. Gameplay inference — the battle log's
 * top-damage attacker, or (when nobody attacked) the opponent's
 * most-played/evolved-into Pokémon — only applies once archetype
 * resolution comes up empty: no archetype was logged, or the free text
 * didn't match anything recognizable.
 */
export function resolveOpponentHero({
  opponentArchetype,
  gameplayName,
}: {
  /** The match's own free-text opponent_archetype field, as typed (battle
   *  log import) or selected (manual match log) by the player. */
  opponentArchetype: string | null;
  /** Battle-log inference, already collapsed to one name by the caller:
   *  the opponent's top-damage attacker, falling back to their
   *  most-played/evolved-into Pokémon when nobody attacked. Both current
   *  callers already compute this cascade themselves before calling in. */
  gameplayName: string | null;
}): OpponentHeroCard | null {
  if (opponentArchetype) {
    const archetypeCard = metaArchetypeCard(opponentArchetype);
    if (archetypeCard) {
      return {
        name: archetypeCard.name,
        imageUrl: archetypeCard.imageUrl,
        color: typeColor(archetypeCard.types),
      };
    }
    // Not an exact top-30 match — catches typos, rotated-out decks, casing,
    // or a compound archetype ("Charizard ex / Pidgeot ex") that still
    // names a real card even though the whole string doesn't match.
    const parsedName = findPokemonNameInText(opponentArchetype);
    const resolved = parsedName ? escalateAndResolve(parsedName) : null;
    if (resolved) return resolved;
  }
  return gameplayName ? escalateAndResolve(gameplayName) : null;
}

/**
 * Two escalations, in order: up the evolution line to its final stage, then
 * across to that species' headline rule-box variant. Both are needed — the
 * first turns a "Drakloak" attacker into a Dragapult, the second turns a
 * bare "Dragapult" (which is where a free-text archetype like "Dragapult
 * Dusknoir" parses to) into the Standard-legal "Dragapult ex" rather than a
 * rotated-out Sword & Shield print. See headlineVariantForName for why the
 * evolution walk alone can't cover the second case.
 */
function escalateAndResolve(name: string): OpponentHeroCard | null {
  const escalated = headlineVariantForName(highestEvolutionForName(name));
  const imageUrl = cardImageUrlForName(escalated);
  if (!imageUrl) return null;
  return { name: escalated, imageUrl, color: typeColor(cardTypesForName(escalated)) };
}
