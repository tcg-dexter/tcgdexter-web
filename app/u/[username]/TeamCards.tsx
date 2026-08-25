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

const SLOTS = 7;

// Fan geometry — identical to MetaProfileHeader's card fan (see that file
// for the full derivation). Slot count is fixed at SLOTS here (unlike the
// meta header, which fans however many cards it actually has), so every
// position/rotation is a constant computed once below rather than derived
// per-render from a variable card count.
const CARDS_SPAN_PCT = 110.4;
const DESKTOP_CARDS_SPAN_PCT = CARDS_SPAN_PCT * 1.1;
const CARD_WIDTH_PCT = 32;
const BOTTOM_CLIP_PCT = 35;
const CENTER_RAISE_CARD_PCT = 11;
const CARD_MAX_ROTATION_DEG = 12;

interface SlotGeometry {
  left: number;
  leftDesktop: number;
  clipPct: number;
  rotationDeg: number;
  zIndex: number;
  /** Distance back to the stack (slot 0's position), in percent of the
   *  card's own width. Percent-of-self rather than percent-of-banner so
   *  the entrance stays correct at every banner size — see the
   *  `dx-fan-in` keyframes in globals.css.
   *
   *  One value, not one per breakpoint, because `left` below is an inline
   *  style: the style attribute outranks every non-important author rule,
   *  so the `sm:[left:var(--left-sm)]` utility beside it never actually
   *  wins and `leftDesktop` is not the settled position at any width. The
   *  delta has to be measured against the position that really applies. */
  fanDx: number;
}

const SLOT_GEOMETRY: SlotGeometry[] = (() => {
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
      // (leftmost - mine), converted from percent-of-container into
      // percent-of-card by dividing through the card's own width share.
      fanDx: ((cardsLeftStart - left) / CARD_WIDTH_PCT) * 100,
    };
  });
})();

/** Pad / trim the persisted array to exactly SLOTS length. */
function normalize(team: (TeamCardRef | null)[]): (TeamCardRef | null)[] {
  const out: (TeamCardRef | null)[] = [];
  for (let i = 0; i < SLOTS; i++) out.push(team[i] ?? null);
  return out;
}

/** Slot 0 — the stack every card fans out of. Its clip and rotation are
 *  what the others hold while they wait their turn. */
const STACK = SLOT_GEOMETRY[0];

/** Milliseconds between one card leaving the stack and the next. Small
 *  enough that the whole fan is open in well under a second. */
const FAN_STAGGER_MS = 45;

function slotStyle(g: SlotGeometry, index: number): CSSProperties {
  return {
    bottom: 0,
    left: `${g.left}%`,
    "--left-sm": `${g.leftDesktop}%`,
    width: `${CARD_WIDTH_PCT}%`,
    // The settled transform and transform-origin live in the .dx-fan-card
    // class, composed from these properties, so the base style and the
    // animation's end frame can't drift apart.
    "--fan-clip": `${g.clipPct}%`,
    "--fan-rot": `${g.rotationDeg}deg`,
    "--fan-clip-start": `${STACK.clipPct}%`,
    "--fan-rot-start": `${STACK.rotationDeg}deg`,
    "--fan-dx": `${g.fanDx}%`,
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
  const team = normalize(initial);
  return (
    <div className="relative h-full mx-6 sm:scale-[0.576] sm:origin-bottom sm:translate-y-[10px]">
      {team.map((card, i) => (
        <CardSlot
          key={i}
          card={card}
          geometry={SLOT_GEOMETRY[i]}
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
        className="dx-fan-card absolute drop-shadow-md select-none rounded-lg sm:[left:var(--left-sm)]"
        style={slotStyle(geometry, index)}
      />
    );
  }

  // Empty slot — dashed outline for the owner (room to fill via the
  // pencil menu), a fainter outline for visitors.
  return (
    <div
      aria-hidden="true"
      className={`dx-fan-card absolute aspect-[245/342] rounded-lg border-2 border-dashed sm:[left:var(--left-sm)] ${
        isOwner ? "border-white/70 bg-white/10" : "border-white/40"
      }`}
      style={slotStyle(geometry, index)}
    />
  );
}
