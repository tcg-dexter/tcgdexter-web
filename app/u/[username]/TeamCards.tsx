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
    return {
      left: cardsLeftStart + i * cardsStep,
      leftDesktop: desktopCardsLeftStart + i * desktopCardsStep,
      clipPct: BOTTOM_CLIP_PCT - CENTER_RAISE_CARD_PCT * (1 - normDist * normDist),
      rotationDeg: (signedDist / maxDist) * CARD_MAX_ROTATION_DEG,
      zIndex: i,
    };
  });
})();

/** Pad / trim the persisted array to exactly SLOTS length. */
function normalize(team: (TeamCardRef | null)[]): (TeamCardRef | null)[] {
  const out: (TeamCardRef | null)[] = [];
  for (let i = 0; i < SLOTS; i++) out.push(team[i] ?? null);
  return out;
}

function slotStyle(g: SlotGeometry): CSSProperties {
  return {
    bottom: 0,
    left: `${g.left}%`,
    "--left-sm": `${g.leftDesktop}%`,
    width: `${CARD_WIDTH_PCT}%`,
    transform: `translateY(${g.clipPct}%) rotate(${g.rotationDeg}deg)`,
    transformOrigin: "50% 100%",
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
 */
export default function TeamCards({ initial, isOwner }: Props) {
  const team = normalize(initial);
  return (
    <div className="relative h-full mx-6 sm:scale-[0.576] sm:origin-bottom sm:translate-y-[10px]">
      {team.map((card, i) => (
        <CardSlot key={i} card={card} geometry={SLOT_GEOMETRY[i]} isOwner={isOwner} />
      ))}
    </div>
  );
}

/* ─── CardSlot ──────────────────────────────────────────────── */

function CardSlot({
  card,
  geometry,
  isOwner,
}: {
  card: TeamCardRef | null;
  geometry: SlotGeometry;
  isOwner: boolean;
}) {
  if (card) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={cardImageLarge(card.set_id, card.number)}
        alt=""
        aria-hidden="true"
        className="absolute drop-shadow-md select-none rounded-lg sm:[left:var(--left-sm)]"
        style={slotStyle(geometry)}
      />
    );
  }

  // Empty slot — dashed outline for the owner (room to fill via the
  // pencil menu), a fainter outline for visitors.
  return (
    <div
      aria-hidden="true"
      className={`absolute aspect-[245/342] rounded-lg border-2 border-dashed sm:[left:var(--left-sm)] ${
        isOwner ? "border-white/70 bg-white/10" : "border-white/40"
      }`}
      style={slotStyle(geometry)}
    />
  );
}
