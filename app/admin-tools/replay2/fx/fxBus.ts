/**
 * The FX bus.
 *
 * Effects are emitted in *client* coordinates by whichever component knows
 * where it is — a struck card emits its own centre — and the canvas converts
 * them into its own space. That inversion is the whole point: the alternative
 * is threading board geometry down to every card so each can compute a
 * position in some shared coordinate system, which means every card needs to
 * know about the FX layer. This way they only need to know about themselves.
 *
 * Deliberately imperative and outside React. Particles are per-frame state
 * with no bearing on what the DOM renders; running them through component
 * state would re-render the entire board sixty times a second to move dots
 * around a canvas.
 */

export type FxKind =
  /** A blow landing: shards radiating from the point of contact. */
  | "impact"
  /** Energy arriving: particles converging inward onto a card. */
  | "converge"
  /** A Pokémon leaving the board: heavier debris, and it falls. */
  | "debris"
  /** A small pop — an ability firing, a prize taken. */
  | "spark";

export interface FxEvent {
  kind: FxKind;
  /** Client coordinates of the effect's origin. */
  clientX: number;
  clientY: number;
  /** Roughly "how big a deal" — scales particle count, speed and spread.
   *  1 is the ordinary case; an attack scales this with its damage. */
  intensity?: number;
  /** CSS colour. Energy effects use their type's colour; impacts default to
   *  a hot white-red. */
  color?: string;
}

/**
 * A request to point the camera at something. Rides the same bus as the
 * particles because it comes from the same place — the card that knows it is
 * the subject of this beat — and for the same reason: the card shouldn't need
 * to know the board's geometry to ask for attention.
 */
export interface FxFocus {
  clientX: number;
  clientY: number;
  /** The beat this focus belongs to. The camera samples once per action and
   *  ignores repeats: focusing moves the board, which moves the card, which
   *  would ask to be focused again from its new position. */
  actionIndex: number;
  /** Climax beats get a push-in and a shake; everything else a gentle lean. */
  climax: boolean;
}

/**
 * The name of the attack or ability being used, and where the card using it
 * is standing.
 *
 * Rides the bus for the same reason focus does, plus one of its own: the
 * plate has to out-paint the whole board. Rendered inside the card it would
 * sit under the bench overlay on the top mat (the bench is a later sibling of
 * the grid, so it paints over the Active slot) and under the mat tabs on the
 * bottom one, where the Active is top-pinned and the plate lands outside the
 * mat entirely. Board level is the only place it reliably wins.
 */
export interface FxMovePlate {
  actionIndex: number;
  /** Attack or ability name, already checked non-empty by the emitter. */
  label: string;
  kind: "attack" | "ability";
  /** Whose mat the move belongs to. */
  actor: "player" | "opponent";
  /**
   * The MAT's on-screen box, not the card's.
   *
   * The plate used to hang above whichever card was acting, which put it in a
   * different place every beat and sometimes over the bench it was trying to
   * describe. Anchoring to the mat gives it one home per player, so the eye
   * learns where to find it.
   */
  matLeft: number;
  matTop: number;
  matWidth: number;
  matHeight: number;
  /** The acting card's width, so the plate scales with the board rather than
   *  being a fixed size that swamps a small mat and gets lost on a large one. */
  cardWidth: number;
}

/**
 * A card leaving the deck.
 *
 * Drawing was the one thing that happened every single turn and had no
 * physical account of itself: the deck's count went down, the hand's went up,
 * and nothing travelled between them. This carries the geometry needed to fly
 * a card from one to the other — emitted by the draw pile, which is the only
 * component that knows where it is.
 */
export interface FxDrawFlight {
  actionIndex: number;
  actor: "player" | "opponent";
  /** How many cards left the deck. */
  count: number;
  /** The log named them, so they are shown face-up over a dimmed mat before
   *  they land. An unnamed draw — the opponent's, mostly — stays face-down. */
  revealed: boolean;
  pileLeft: number;
  pileTop: number;
  pileWidth: number;
  pileHeight: number;
  matLeft: number;
  matTop: number;
  matWidth: number;
  matHeight: number;
  cardWidth: number;
}

type FxListener = (e: FxEvent) => void;
type FocusListener = (f: FxFocus) => void;
type PlateListener = (p: FxMovePlate) => void;
type DrawListener = (d: FxDrawFlight) => void;

const fxListeners = new Set<FxListener>();
const focusListeners = new Set<FocusListener>();
const plateListeners = new Set<PlateListener>();
const drawListeners = new Set<DrawListener>();

export function emitFx(e: FxEvent): void {
  fxListeners.forEach((l) => l(e));
}

export function onFx(l: FxListener): () => void {
  fxListeners.add(l);
  return () => fxListeners.delete(l);
}

export function emitFocus(f: FxFocus): void {
  focusListeners.forEach((l) => l(f));
}

export function onFocus(l: FocusListener): () => void {
  focusListeners.add(l);
  return () => focusListeners.delete(l);
}

export function emitMovePlate(p: FxMovePlate): void {
  plateListeners.forEach((l) => l(p));
}

export function onMovePlate(l: PlateListener): () => void {
  plateListeners.add(l);
  return () => plateListeners.delete(l);
}

/**
 * Whether a beat sends a card out of the deck, and what it should look like.
 *
 * Split out from the draw pile's emit so the decision can be checked against
 * real logs. Everything else about the flight is geometry the pile measures at
 * the moment it fires; this is the only part with a judgement in it.
 *
 * Returns null for anything that isn't a draw — including the draws folded
 * into a Trade or an Ultra Ball, which arrive as `ability` and `play_trainer`
 * beats with their own exchange overlay and would otherwise be animated twice.
 */
export function drawFlightFor(
  beat: { kind: string; count?: number; cards?: string[]; handSize?: number } | null,
): { count: number; revealed: boolean } | null {
  if (!beat) return null;
  if (beat.kind === "opening_hand") {
    // Always shown: the opening hand is the one draw everybody is entitled to
    // see, and the log always lists it for the exporting player.
    return { count: Math.max(1, beat.handSize ?? 7), revealed: true };
  }
  if (beat.kind !== "draw") return null;
  return {
    count: Math.max(1, beat.count ?? 1),
    // The log names the draws of whoever exported it — which is not always
    // the side the payload is normalized to — so this is what decides
    // face-up versus face-down, rather than any rule about sides.
    revealed: (beat.cards?.length ?? 0) > 0,
  };
}

export function emitDrawFlight(d: FxDrawFlight): void {
  drawListeners.forEach((l) => l(d));
}

export function onDrawFlight(l: DrawListener): () => void {
  drawListeners.add(l);
  return () => drawListeners.delete(l);
}

/* ──────────────────────────────────────────────────────────────── */
/* Energy colours                                                   */
/* ──────────────────────────────────────────────────────────────── */

/**
 * One colour per basic energy type, for the particles an attachment throws.
 *
 * Written out rather than sampled from the mat gradients in DeckMatClient:
 * those are two-stop backgrounds tuned to sit *behind* cards at low contrast,
 * and particles need a single saturated colour that reads at 3px against
 * whatever art it lands on.
 */
const ENERGY_COLORS: Record<string, string> = {
  Grass: "#4ade80",
  Fire: "#fb923c",
  Water: "#38bdf8",
  Lightning: "#facc15",
  Psychic: "#c084fc",
  Fighting: "#f97316",
  Darkness: "#818cf8",
  Metal: "#94a3b8",
  Fairy: "#f472b6",
  Dragon: "#d4af37",
  Colorless: "#e2e8f0",
};

export function energyColor(type: string): string {
  return ENERGY_COLORS[type] ?? ENERGY_COLORS.Colorless;
}

/**
 * One colour per special condition, matched to the pills already on the cards
 * (CONDITION_PILL in BoardKit2) so the wash that announces a condition and the
 * badge that records it are visibly the same thing.
 */
const CONDITION_COLORS: Record<string, string> = {
  Poisoned: "#9333ea",
  // Red rather than the orange of the corner pill: burn reads as red, and the
  // ring drawn around the card is a bigger, more literal statement than the
  // badge. If the two should match, the pill is the one to move.
  Burned: "#ef4444",
  Confused: "#facc15",
  Asleep: "#0ea5e9",
  Paralyzed: "#fbbf24",
};

export function conditionColor(condition: string): string {
  return CONDITION_COLORS[condition] ?? "#94a3b8";
}
