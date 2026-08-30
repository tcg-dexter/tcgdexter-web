import type { Beat } from "@/lib/replay2/beats";

/**
 * Working out which card on the board a beat is about.
 *
 * Deliberately free of React and of anything that renders. The rule that an
 * attack comes from the Active Spot is a plain function here, so it can be
 * checked against real logs in a test — rather than being a property that is
 * only observable by watching a replay and noticing the wrong card lit up,
 * which is how it went unnoticed in the first place.
 */

export type CardRole = "actor" | "target" | "bystander";

/* ──────────────────────────────────────────────────────────────── */
/* Beat → role                                                      */
/* ──────────────────────────────────────────────────────────────── */

/**
 * What a beat's subject is, when it has one.
 *
 * A name, plus — where the rules or the log make it knowable — the slot that
 * Pokémon must be standing in. The position half is what stops an attack
 * being attributed to a benched Pokémon that happens to share the attacker's
 * name: a benched Pokémon cannot attack, so an attacker is categorically the
 * Active one, and there is exactly one of those per mat.
 *
 * Some beats name nobody and still clearly happen TO a card: a retreat is
 * written as "paid the cost and withdrew", with the Pokémon it happened to
 * implied by being the one in the Active spot. Those resolve purely
 * positionally.
 */
type Subject =
  | { name: string; position?: "active" | "bench" }
  | "active"
  | null;

/**
 * Who a beat is about: the Pokémon doing the thing, and the one it happens to.
 *
 * Subjects sit on the actor's own mat unless stated otherwise. An attack is
 * the one beat that reaches across the board.
 *
 * A `position` is only set where it is genuinely known — from the rules of
 * the game, or from a field the parser actually recorded. A guess here is
 * worse than no constraint, because it turns "animate both same-named cards"
 * into "confidently animate the wrong one".
 */
function subjectsOf(beat: Beat): {
  actor: Subject;
  target: Subject;
  targetOnOpposingMat: boolean;
} {
  const none = { actor: null as Subject, target: null as Subject, targetOnOpposingMat: false };
  const named = (n: string, position?: "active" | "bench"): Subject =>
    n ? { name: n, position } : null;
  switch (beat.kind) {
    case "attack":
      // Both ends pinned to the Active Spot, by the rules rather than by
      // anything the log said: only the Active Pokémon can attack, and the
      // defender of a direct attack is the opposing Active. (Splash damage
      // does reach the bench, but that arrives on the beat as `splash`, not
      // as `defender`.)
      return {
        actor: named(beat.attacker, "active"),
        target: named(beat.defender, "active"),
        targetOnOpposingMat: true,
      };
    case "ability":
      // Abilities fire from the bench as often as from the Active — Trade,
      // Recon Directive — and the log gives no slot. Genuinely unconstrained.
      return { ...none, actor: named(beat.source) };
    case "evolve":
      // The post-evolution name: by the time this frame renders, the card on
      // the board is already the new stage. The parser records which slot.
      return { ...none, actor: named(beat.to, beat.location === "active" ? "active" : beat.location === "bench" ? "bench" : undefined) };
    case "switch_active":
      // Whatever was promoted is, by definition, the Active one now.
      return { ...none, actor: named(beat.promoted, "active") };
    case "play_to_slot":
      return { ...none, actor: named(beat.card, beat.slot) };
    case "attach_energy":
      return { ...none, target: named(beat.target, beat.location ?? undefined) };
    case "knock_out":
      return { ...none, target: named(beat.pokemon, beat.where ?? undefined) };
    case "condition":
      // Special Conditions only ever affect the Active Pokémon — a Pokémon
      // that leaves the Active Spot sheds them. The log doesn't state the
      // slot; the rules do.
      return { ...none, target: named(beat.pokemon, "active") };
    case "damage_counters":
      // This beat is only emitted for between-turns Poison/Burn damage, which
      // likewise only applies to the Active Pokémon.
      return { ...none, target: named(beat.pokemon, "active") };
    case "discard_from_pokemon":
      return { ...none, target: named(beat.from) };
    case "damage_counters_moved":
      // The counters come off `from` and land on `to`, and the two are
      // routinely on opposite mats — Adrena-Brain's whole point is moving
      // your own damage onto the opponent. Each mat claims whichever end it
      // holds, so both cards perform; targetOnOpposingMat can't express that,
      // hence the pair being resolved independently below.
      return { actor: named(beat.from), target: named(beat.to), targetOnOpposingMat: false };
    case "retreat":
      // The log names only the energy discarded to pay for it. The Pokémon
      // retreating is whichever one is still Active on this frame — the
      // promotion of its replacement arrives as its own switch_active beat.
      return { ...none, target: "active" };
    default:
      return none;
  }
}

/* ──────────────────────────────────────────────────────────────── */
/* Claiming                                                         */
/* ──────────────────────────────────────────────────────────────── */

/** The specific cards, by engine instance id, that this beat is about. */
export interface BeatClaim {
  actorId: string | null;
  targetId: string | null;
  /**
   * Cards struck by an effect that hits several at once, and how much damage
   * each took. Freezing Shroud puts a counter on every Pokémon in play with
   * an ability, which can be eight cards across both mats — a single
   * targetId cannot express that, and picking one of them to animate would
   * misrepresent what happened.
   */
  struck: Record<string, number>;
}

export const NO_CLAIM: BeatClaim = { actorId: null, targetId: null, struck: {} };

interface ClaimCandidate {
  id: string;
  name: string;
}

/**
 * Pick the ONE card on a mat that a subject refers to.
 *
 * Duplicate names on a board are ordinary — three Noctowl on a bench, two
 * Dragapult — and the log identifies Pokémon by name alone, so a name can
 * genuinely be ambiguous. Where position narrows it (an attacker is the
 * Active one) it is exact. Where it doesn't, this mirrors the engine's own
 * `findPokemon`: first match scanning Active before Bench. That tie-break is
 * not arbitrary — it means the card that performs is the same card whose
 * state the engine actually changed, so the animation and the board agree
 * even when the log is ambiguous.
 */
function resolveOnMat(
  subject: Subject,
  active: ClaimCandidate | null,
  bench: ClaimCandidate[],
): string | null {
  if (subject == null) return null;
  if (subject === "active") return active?.id ?? null;
  const { name, position } = subject;
  if (position === "active") {
    return active && active.name === name ? active.id : null;
  }
  const pool =
    position === "bench" ? bench : active ? [active, ...bench] : bench;
  return pool.find((p) => p.name === name)?.id ?? null;
}

/**
 * Resolve a beat against one mat's cards.
 *
 * Deliberately computed once per mat, by the component that can see the whole
 * board, rather than by each card asking "is this about me?" in isolation.
 * The old per-card test could only compare names, so every same-named card
 * answered yes and they all performed together — which is how an attack ended
 * up being attributed to a benched Pokémon. A single resolution that returns
 * an id can only ever pick one.
 */
export interface MatCards {
  active: ClaimCandidate | null;
  bench: ClaimCandidate[];
}

export function resolveClaim(
  beat: Beat | null,
  matActor: "player" | "opponent" | null,
  cards: MatCards,
  /** The same mat one frame earlier. A beat's subject may have already left
   *  the board by the frame that announces it — a knocked-out Pokémon is in
   *  the discard by then — while AnimatePresence is still rendering it on its
   *  way out, and it is the only thing left that knows where it stood. */
  previous: MatCards,
): BeatClaim {
  if (!beat || !matActor) return NO_CLAIM;
  const { actor, target, targetOnOpposingMat } = subjectsOf(beat);
  // Most beats belong to one player's mat. Two don't: Freezing Shroud puts
  // counters on Pokémon across BOTH boards, and Adrena-Brain moves damage
  // from a Pokémon on one mat to a Pokémon on the other. For those, each mat
  // resolves whatever it happens to be holding rather than checking whose
  // turn it is first — the log's own owner attribution on those lines is
  // wrong anyway (see lib/battle-log/parse.ts).
  const boardWide =
    beat.kind === "damage_counters_placed" || beat.kind === "damage_counters_moved";
  const onActorMat = boardWide || matActor === beat.actor;
  const targetMat = boardWide
    ? true
    : targetOnOpposingMat
      ? beat.actor !== matActor
      : onActorMat;
  const resolve = (subject: Subject): string | null =>
    resolveOnMat(subject, cards.active, cards.bench) ??
    resolveOnMat(subject, previous.active, previous.bench);
  return {
    actorId: onActorMat ? resolve(actor) : null,
    targetId: targetMat ? resolve(target) : null,
    struck: beat.kind === "damage_counters_placed"
      ? resolveStruck(beat.applied, matActor, cards)
      : {},
  };
}

/**
 * Which of this mat's cards a multi-target effect landed on.
 *
 * Works from the engine's `applied` list rather than the log's `targets`:
 * the engine has already decided which board each hit resolved to, so the
 * owner is trustworthy here even though the handle on the original log line
 * was not. Filtering by owner first is what keeps a Munkidori on one mat from
 * claiming a hit that landed on the identically named one opposite.
 *
 * Within a mat, each entry claims a distinct card for the same reason the
 * reducer does: the effect hits each Pokémon once, so two entries with the
 * same name mean two Pokémon, not one taking double.
 */
function resolveStruck(
  applied: { pokemon: string; owner: string; counters: number }[],
  matActor: "player" | "opponent",
  cards: MatCards,
): Record<string, number> {
  const pool = cards.active ? [cards.active, ...cards.bench] : cards.bench;
  const claimed = new Set<string>();
  const struck: Record<string, number> = {};
  for (const hit of applied) {
    if (hit.owner !== matActor) continue;
    const card = pool.find((c) => !claimed.has(c.id) && c.name === hit.pokemon);
    if (!card) continue;
    claimed.add(card.id);
    struck[card.id] = hit.counters * 10;
  }
  return struck;
}

/**
 * Which of a beat's two subjects the camera should look at.
 *
 * The target when there is one: an attack's story is where the damage lands,
 * not where it was thrown from, and an energy attachment or a condition has
 * no actor card at all. Falls back to the actor for the beats that are purely
 * someone doing something — an ability firing, a Pokémon being promoted.
 */
export function focusRole(beat: Beat): CardRole {
  return subjectsOf(beat).target ? "target" : "actor";
}
