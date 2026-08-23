import { shade } from "@/lib/color";
import LayerCanvas from "./LayerCanvas";
import { SECTION_LABEL_STYLE, STAT_DIGIT_STYLE } from "./chrome";
import {
  CANVAS_H,
  CANVAS_W,
  proxied,
  type FeaturedBattleLikeSubject,
  type StudioLayer,
  type TemplateCopy,
} from "./types";

interface Props {
  subject: FeaturedBattleLikeSubject;
  copy: TemplateCopy;
}

// Most social platforms crop a 9:16 share (1080×1920) down to 4:5
// (1080×1350) for feed posts and grid previews, taking the vertically
// centered band — keep every layer within [SAFE_TOP, CANVAS_H - SAFE_TOP]
// so nothing gets clipped in those crops.
const SAFE_TOP = (CANVAS_H - (CANVAS_W * 5) / 4) / 2;

// Card stack geometry. Cards are ~card-aspect tall (≈ width * 1.4).
const CARD_WIDTH = 380;
const CARD_HEIGHT = 532;
const STACK_TOP = 608;
const STACK_BOTTOM = STACK_TOP + CARD_HEIGHT;
const STACK_CENTER_Y = STACK_TOP + CARD_HEIGHT / 2;

/** One side of the versus stack. `side` drives the tilt + horizontal
 *  placement; geometry matches the original flex layout (two 380px cards
 *  with a 40px gap, centered), but each card lives on its own layer so
 *  the editor can export/animate the sides independently. */
function VersusCard({
  side,
  imageUrl,
  alt,
}: {
  side: "player" | "opponent";
  imageUrl: string | null;
  alt: string;
}) {
  const offset = side === "player" ? -(CARD_WIDTH + 20) : 20;
  return (
    <div
      style={{
        position: "absolute",
        top: STACK_TOP,
        left: "50%",
        marginLeft: offset,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        display: "flex",
        alignItems: "center",
      }}
    >
      <div
        style={{
          transform: `rotate(${side === "player" ? -8 : 8}deg)`,
          transformOrigin: "center center",
          width: CARD_WIDTH,
          borderRadius: 18,
          overflow: "hidden",
          background: "rgba(0,0,0,0.15)",
          boxShadow: "0 30px 60px rgba(0,0,0,0.45)",
        }}
      >
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={proxied(imageUrl)}
            alt={alt}
            style={{ width: "100%", height: "auto", display: "block" }}
          />
        )}
      </div>
    </div>
  );
}

const HANDLE_STYLE: React.CSSProperties = {
  width: "45%",
  textAlign: "center",
  fontSize: 56,
  fontWeight: 800,
  letterSpacing: "-0.01em",
  lineHeight: 1.1,
  textShadow: "0 4px 16px rgba(0,0,0,0.35)",
  wordBreak: "break-word",
};

export function buildFeaturedBattleLayers(
  subject: FeaturedBattleLikeSubject,
  copy: TemplateCopy,
): StudioLayer[] {
  // Split gradient: player-side type color on the left, opponent's on
  // the right. Each side darkens vertically so the bottom reads denser
  // (good for big white prize digits + handle labels).
  const playerTop = subject.playerAccentColor || "#B0A89E";
  const opponentTop = subject.opponentAccentColor || "#B0A89E";
  const overlay = `linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.35) 100%)`;

  // Faint side-tint gradients so the seam reads softer than a hard 50/50.
  const leftWash = `linear-gradient(180deg, ${shade(playerTop, 6)} 0%, ${shade(playerTop, -28)} 100%)`;
  const rightWash = `linear-gradient(180deg, ${shade(opponentTop, 6)} 0%, ${shade(opponentTop, -28)} 100%)`;

  return [
    {
      id: "background",
      name: "Background",
      node: (
        <>
          <div style={{ position: "absolute", left: 0, top: 0, width: "50%", height: "100%", background: leftWash }} />
          <div style={{ position: "absolute", left: "50%", top: 0, width: "50%", height: "100%", background: rightWash }} />
          <div style={{ position: "absolute", inset: 0, background: overlay }} />
        </>
      ),
    },
    {
      // Platform subtitle — top-most label, sits in the space the
      // eyebrow used to occupy, with extra room below before the
      // handle row. "TCG Live" for imported logs, "Battle Log" for
      // manual entries.
      id: "platform-label",
      name: "Platform Label",
      node: (
        <div
          style={{
            ...SECTION_LABEL_STYLE,
            fontSize: 56,
            position: "absolute",
            top: SAFE_TOP + 55,
            left: 0,
            right: 0,
          }}
        >
          {subject.platformLabel}
        </div>
      ),
    },
    {
      id: "handles",
      name: "Player Handles",
      node: (
        <div
          style={{
            position: "absolute",
            top: STACK_TOP - 121,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "space-between",
            padding: "0 80px",
          }}
        >
          <div style={HANDLE_STYLE}>{subject.playerHandle ?? "—"}</div>
          <div style={HANDLE_STYLE}>{subject.opponentHandle ?? "—"}</div>
        </div>
      ),
    },
    {
      id: "player-card",
      name: "Player Card",
      node: (
        <VersusCard
          side="player"
          imageUrl={subject.deckCoverUrl}
          alt={subject.deckName}
        />
      ),
    },
    {
      id: "opponent-card",
      name: "Opponent Card",
      node: (
        <VersusCard
          side="opponent"
          imageUrl={subject.opponentImageUrl}
          alt="Opponent featured Pokémon"
        />
      ),
    },
    {
      id: "vs",
      name: "VS Glyph",
      node: (
        <span
          style={{
            position: "absolute",
            left: "50%",
            top: STACK_CENTER_Y,
            transform: "translate(-50%, -50%)",
            fontSize: 64,
            fontWeight: 900,
            letterSpacing: "0.2em",
            color: "#fff",
            textShadow:
              "0 0 24px rgba(0,0,0,0.55), 0 8px 28px rgba(0,0,0,0.65), 0 2px 4px rgba(0,0,0,0.7)",
          }}
        >
          VS
        </span>
      ),
    },
    {
      // "PRIZES TAKEN" — same family as TCG Live, but 25% smaller so
      // the two labels read as primary / secondary rather than equal.
      id: "prizes",
      name: "Prizes Taken",
      node: (
        <>
          <div
            style={{
              ...SECTION_LABEL_STYLE,
              fontSize: 42,
              position: "absolute",
              top: STACK_BOTTOM + 74,
              left: 0,
              right: 0,
            }}
          >
            Prizes Taken
          </div>
          <div
            style={{
              position: "absolute",
              top: STACK_BOTTOM + 159,
              left: 0,
              right: 0,
              display: "flex",
              justifyContent: "space-between",
              padding: "0 120px",
              alignItems: "flex-start",
            }}
          >
            <span style={{ ...STAT_DIGIT_STYLE, width: "40%", fontSize: 200 }}>
              {subject.playerPrizes}
            </span>
            <span style={{ ...STAT_DIGIT_STYLE, width: "40%", fontSize: 200 }}>
              {subject.opponentPrizes}
            </span>
          </div>
        </>
      ),
    },
    {
      // Site mark — sits just below the prize digits, comfortably above
      // SAFE_BOTTOM so it survives a 4:5 crop.
      id: "site-mark",
      name: "Site Mark",
      node: (
        <div
          style={{
            position: "absolute",
            top: STACK_BOTTOM + 432,
            transform: "translateY(-50%)",
            left: 0,
            right: 0,
            textAlign: "center",
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.85)",
          }}
        >
          tcgdexter.com
        </div>
      ),
    },
  ];
}

export default function FeaturedBattleTemplate({ subject, copy }: Props) {
  return <LayerCanvas layers={buildFeaturedBattleLayers(subject, copy)} />;
}
