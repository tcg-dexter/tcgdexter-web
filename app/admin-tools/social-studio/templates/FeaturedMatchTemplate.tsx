import { shade } from "@/lib/color";
import { CANVAS_H, CANVAS_W, type FeaturedMatchSubject, type TemplateCopy } from "./types";

interface Props {
  subject: FeaturedMatchSubject;
  copy: TemplateCopy;
}

// Card stack geometry. Cards are ~card-aspect tall (≈ width * 1.4).
// The stack is centered at 40% down the canvas so the handle row above
// has room, and the Prizes Taken block + URL below it stack cleanly.
const CARD_WIDTH = 380;
const CARD_HEIGHT = 532;
const STACK_CENTER_Y = CANVAS_H * 0.4;
const STACK_TOP = STACK_CENTER_Y - CARD_HEIGHT / 2;
const STACK_BOTTOM = STACK_TOP + CARD_HEIGHT;

// Shared "section label" style — used by both the "TCG LIVE" subtitle
// and the "PRIZES TAKEN" label so the two read as a matched pair.
const SECTION_LABEL_STYLE: React.CSSProperties = {
  fontSize: 56,
  fontWeight: 800,
  letterSpacing: "0.32em",
  textTransform: "uppercase",
  textShadow: "0 4px 16px rgba(0,0,0,0.4)",
  textAlign: "center",
};

export default function FeaturedMatchTemplate({ subject, copy }: Props) {
  // Split gradient: player-side type color on the left, opponent's on
  // the right. Each side darkens vertically so the bottom reads denser
  // (good for big white prize digits + handle labels).
  const playerTop = subject.playerAccentColor || "#B0A89E";
  const opponentTop = subject.opponentAccentColor || "#B0A89E";
  const overlay = `linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.35) 100%)`;

  // Faint side-tint gradients so the seam reads softer than a hard 50/50.
  const leftWash = `linear-gradient(180deg, ${shade(playerTop, 6)} 0%, ${shade(playerTop, -28)} 100%)`;
  const rightWash = `linear-gradient(180deg, ${shade(opponentTop, 6)} 0%, ${shade(opponentTop, -28)} 100%)`;

  return (
    <div
      style={{
        width: CANVAS_W,
        height: CANVAS_H,
        position: "relative",
        overflow: "hidden",
        fontFamily: "var(--font-sans, system-ui)",
        color: "#fff",
      }}
    >
      {/* Per-side vertical wash */}
      <div style={{ position: "absolute", left: 0, top: 0, width: "50%", height: "100%", background: leftWash }} />
      <div style={{ position: "absolute", left: "50%", top: 0, width: "50%", height: "100%", background: rightWash }} />
      {/* Bottom darken overlay for legibility */}
      <div style={{ position: "absolute", inset: 0, background: overlay }} />

      {/* Eyebrow — "Featured Match" */}
      <div
        style={{
          position: "absolute",
          top: 120,
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 32,
          fontWeight: 600,
          letterSpacing: "0.4em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.9)",
          textShadow: "0 2px 12px rgba(0,0,0,0.35)",
        }}
      >
        {copy.eyebrow}
      </div>

      {/* "TCG LIVE" subtitle — single big label below the eyebrow,
          serves as the framing for both handles below. */}
      <div
        style={{
          ...SECTION_LABEL_STYLE,
          position: "absolute",
          top: 190,
          left: 0,
          right: 0,
        }}
      >
        TCG Live
      </div>

      {/* Player handles — sit above the card stack, one per side */}
      <div
        style={{
          position: "absolute",
          top: STACK_TOP - 140,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "space-between",
          padding: "0 80px",
        }}
      >
        <div
          style={{
            width: "45%",
            textAlign: "center",
            fontSize: 56,
            fontWeight: 800,
            letterSpacing: "-0.01em",
            lineHeight: 1.1,
            textShadow: "0 4px 16px rgba(0,0,0,0.35)",
            wordBreak: "break-word",
          }}
        >
          {subject.playerHandle ?? "—"}
        </div>
        <div
          style={{
            width: "45%",
            textAlign: "center",
            fontSize: 56,
            fontWeight: 800,
            letterSpacing: "-0.01em",
            lineHeight: 1.1,
            textShadow: "0 4px 16px rgba(0,0,0,0.35)",
            wordBreak: "break-word",
          }}
        >
          {subject.opponentHandle ?? "—"}
        </div>
      </div>

      {/* Versus cards — centered vertically in the canvas. */}
      <div
        style={{
          position: "absolute",
          top: STACK_TOP,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 40,
          height: CARD_HEIGHT,
        }}
      >
        <div
          style={{
            transform: "rotate(-8deg)",
            transformOrigin: "center center",
            width: CARD_WIDTH,
            borderRadius: 18,
            overflow: "hidden",
            background: "rgba(0,0,0,0.15)",
            boxShadow: "0 30px 60px rgba(0,0,0,0.45)",
          }}
        >
          {subject.deckCoverUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={subject.deckCoverUrl}
              alt={subject.deckName}
              style={{ width: "100%", height: "auto", display: "block" }}
            />
          )}
        </div>
        <div
          style={{
            transform: "rotate(8deg)",
            transformOrigin: "center center",
            width: CARD_WIDTH,
            borderRadius: 18,
            overflow: "hidden",
            background: "rgba(0,0,0,0.15)",
            boxShadow: "0 30px 60px rgba(0,0,0,0.45)",
          }}
        >
          {subject.opponentImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={subject.opponentImageUrl}
              alt="Opponent featured Pokémon"
              style={{ width: "100%", height: "auto", display: "block" }}
            />
          )}
        </div>
      </div>

      {/* VS glyph — pinned to the stack's vertical midpoint. */}
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

      {/* "PRIZES TAKEN" — same family as TCG Live, but 25% smaller so
          the two labels read as primary / secondary rather than equal. */}
      <div
        style={{
          ...SECTION_LABEL_STYLE,
          fontSize: 42,
          position: "absolute",
          top: STACK_BOTTOM + 110,
          left: 0,
          right: 0,
        }}
      >
        Prizes Taken
      </div>

      {/* Prize counts — big flanking digits placed below the label. */}
      <div
        style={{
          position: "absolute",
          top: STACK_BOTTOM + 200,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "space-between",
          padding: "0 120px",
          alignItems: "flex-start",
        }}
      >
        <span
          style={{
            width: "40%",
            textAlign: "center",
            fontSize: 200,
            fontWeight: 900,
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
            textShadow: "0 8px 28px rgba(0,0,0,0.45)",
          }}
        >
          {subject.playerPrizes}
        </span>
        <span
          style={{
            width: "40%",
            textAlign: "center",
            fontSize: 200,
            fontWeight: 900,
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
            textShadow: "0 8px 28px rgba(0,0,0,0.45)",
          }}
        >
          {subject.opponentPrizes}
        </span>
      </div>

      {/* Site mark — vertically centered between the prize digits and
          the canvas bottom edge. Prize digits sit at top=STACK_BOTTOM+200
          with a 200px line-height, so their visual bottom is roughly
          y=STACK_BOTTOM+400. Midpoint between that and CANVAS_H. */}
      <div
        style={{
          position: "absolute",
          top: (STACK_BOTTOM + 400 + CANVAS_H) / 2,
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
    </div>
  );
}
