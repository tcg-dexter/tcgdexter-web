import type { CSSProperties } from "react";
import { cardImageLarge } from "@/lib/cardImages";

export interface TeamCardRef {
  name: string;
  set_id: string;
  number: string;
}

interface Props {
  initial: (TeamCardRef | null)[];
  isOwner: boolean;
}

/** Slots in a team. Also the cap enforced by the profiles_team_cards_check
 *  constraint on the column this renders. */
export const TEAM_SLOTS = 7;
const SLOTS = TEAM_SLOTS;

// Fan geometry — identical to MetaProfileHeader's card fan (see that file
// for the full derivation). Slot count is fixed at SLOTS here (unlike the
// meta header, which fans however many cards it actually has), so every
// position/rotation is a constant computed once below rather than derived
// per-render from a variable card count.
const CARDS_SPAN_PCT = 110.4;
const DESKTOP_CARDS_SPAN_PCT = CARDS_SPAN_PCT * 1.1;
export const TEAM_CARD_WIDTH_PCT = 32;
const CARD_WIDTH_PCT = TEAM_CARD_WIDTH_PCT;
const BOTTOM_CLIP_PCT = 35;
const CENTER_RAISE_CARD_PCT = 11;
const CARD_MAX_ROTATION_DEG = 12;

/** Printed card aspect, used to turn the width-derived geometry above into
 *  a height. Same ratio the card images are served at. */
const CARD_ASPECT = 342 / 245;

/**
 * How tall the fan stands above the banner's floor, as a share of the
 * banner's WIDTH. The centre card is the binding constraint: it's the one
 * CENTER_RAISE_CARD_PCT lifts, and it isn't rotated, so no other slot
 * reaches higher. A banner sized to this ratio shows the whole fan with
 * nothing clipped off the top.
 *
 * Exported because the trainer directory sizes its own (much smaller)
 * banner from it — deriving the number there would mean copying four
 * constants and a formula that only live here.
 */
export const TEAM_FAN_HEIGHT_RATIO =
  (CARD_WIDTH_PCT / 100) *
  CARD_ASPECT *
  (1 - (BOTTOM_CLIP_PCT - CENTER_RAISE_CARD_PCT) / 100);

/** One slot's resting place in the fan. Percentages throughout, so the
 *  same table drives a full-width profile banner and a preview tile. */
export interface SlotGeometry {
  left: number;
  leftDesktop: number;
  clipPct: number;
  rotationDeg: number;
  zIndex: number;
  /** Distance back to the stack (slot 0's position), in percent of the
   *  card's own width. Percent-of-self rather than percent-of-banner so
   *  the entrance stays correct at every banner size — see the
   *  `dx-fan-in` keyframes in globals.css. One per breakpoint, because
   *  the settled position it is measured against differs between them. */
  fanDx: number;
  fanDxDesktop: number;
}

export const TEAM_SLOT_GEOMETRY: SlotGeometry[] = (() => {
  const cardsLeftStart = (100 - CARDS_SPAN_PCT) / 2;
  const cardsStep = (CARDS_SPAN_PCT - CARD_WIDTH_PCT) / (SLOTS - 1);
  const desktopCardsLeftStart = (100 - DESKTOP_CARDS_SPAN_PCT) / 2;
  const desktopCardsStep = (DESKTOP_CARDS_SPAN_PCT - CARD_WIDTH_PCT) / (SLOTS - 1);
  const center = (SLOTS - 1) / 2;
  const maxDist = center;

  return Array.from({ length: SLOTS }, (_, i) => {
    const signedDist = i - center;
    const normDist = Math.abs(signedDist) / maxDist;
    const left = cardsLeftStart + i * cardsStep;
    const leftDesktop = desktopCardsLeftStart + i * desktopCardsStep;
    return {
      left,
      leftDesktop,
      clipPct: BOTTOM_CLIP_PCT - CENTER_RAISE_CARD_PCT * (1 - normDist * normDist),
      rotationDeg: (signedDist / maxDist) * CARD_MAX_ROTATION_DEG,
      zIndex: i,
      // Both are (leftmost - mine), converted from percent-of-container
      // into percent-of-card by dividing through the card's own width
      // share.
      fanDx: ((cardsLeftStart - left) / CARD_WIDTH_PCT) * 100,
      fanDxDesktop: ((desktopCardsLeftStart - leftDesktop) / CARD_WIDTH_PCT) * 100,
    };
  });
})();

/** Pad / trim the persisted array to exactly SLOTS length. */
export function normalizeTeam(
  team: (TeamCardRef | null)[],
): (TeamCardRef | null)[] {
  const out: (TeamCardRef | null)[] = [];
  for (let i = 0; i < SLOTS; i++) out.push(team[i] ?? null);
  return out;
}

/** Slot 0 — the stack every card fans out of. Its clip and rotation are
 *  what the others hold while they wait their turn. */
const STACK = TEAM_SLOT_GEOMETRY[0];

/** Milliseconds between one card leaving the stack and the next. Small
 *  enough that the whole fan is open in well under a second. */
const FAN_STAGGER_MS = 45;

function slotStyle(g: SlotGeometry, index: number): CSSProperties {
  return {
    bottom: 0,
    width: `${CARD_WIDTH_PCT}%`,
    // Everything the fan needs is handed over as raw values; .dx-fan-card
    // (globals.css) composes them into `left`, the settled transform and
    // the entrance, and picks the breakpoint. Nothing set here may be a
    // property that class also sets — an inline declaration would outrank
    // its media query and pin the card to one breakpoint's layout, which
    // is exactly how the desktop spread used to go missing.
    "--left": `${g.left}%`,
    "--left-sm": `${g.leftDesktop}%`,
    "--fan-clip": `${g.clipPct}%`,
    "--fan-rot": `${g.rotationDeg}deg`,
    "--fan-clip-start": `${STACK.clipPct}%`,
    "--fan-rot-start": `${STACK.rotationDeg}deg`,
    "--fan-dx-base": `${g.fanDx}%`,
    "--fan-dx-sm": `${g.fanDxDesktop}%`,
    "--fan-delay": `${index * FAN_STAGGER_MS}ms`,
    zIndex: g.zIndex,
  } as CSSProperties;
}

/**
 * 7-card fanned team spread in the user profile banner, echoing the meta
 * archetype header's card fan. Purely decorative — picking cards happens
 * in the banner pencil menu's "Select Banner Cards" modal (see
 * AccentPicker / TeamCardsModal), not by interacting with the fan itself.
 * Owner-only empty slots render as a dashed outline so the owner sees
 * there's room to fill; visitor empty slots render as a dim outline.
 *
 * On load the whole row starts stacked on the leftmost slot and fans out
 * with a slight overshoot — a pure CSS animation (`.dx-fan-card` in
 * globals.css) rather than a mounted state flip, so the markup this server
 * component sends is already the settled layout.
 */
export default function TeamCards({ initial, isOwner }: Props) {
  const team = normalizeTeam(initial);
  return (
    <div className="relative h-full mx-6 sm:scale-[0.576] sm:origin-bottom sm:translate-y-[10px]">
      {team.map((card, i) => (
        <CardSlot
          key={i}
          card={card}
          geometry={TEAM_SLOT_GEOMETRY[i]}
          index={i}
          isOwner={isOwner}
        />
      ))}
    </div>
  );
}

/* ─── CardSlot ──────────────────────────────────────────────── */

function CardSlot({
  card,
  geometry,
  index,
  isOwner,
}: {
  card: TeamCardRef | null;
  geometry: SlotGeometry;
  /** Position in the fan — drives the entrance stagger only. */
  index: number;
  isOwner: boolean;
}) {
  if (card) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={cardImageLarge(card.set_id, card.number)}
        alt=""
        aria-hidden="true"
        className="dx-fan-card absolute drop-shadow-md select-none rounded-lg"
        style={slotStyle(geometry, index)}
      />
    );
  }

  // Empty slot — dashed outline for the owner (room to fill via the
  // pencil menu), a fainter outline for visitors.
  return (
    <div
      aria-hidden="true"
      className={`dx-fan-card absolute aspect-[245/342] rounded-lg border-2 border-dashed ${
        isOwner ? "border-white/70 bg-white/10" : "border-white/40"
      }`}
      style={slotStyle(geometry, index)}
    />
  );
}
