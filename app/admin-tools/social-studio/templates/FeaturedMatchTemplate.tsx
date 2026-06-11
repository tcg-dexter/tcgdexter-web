import { shade } from "@/lib/color";
import { CANVAS_H, CANVAS_W, type FeaturedMatchSubject, type TemplateCopy } from "./types";

interface Props {
  subject: FeaturedMatchSubject;
  copy: TemplateCopy;
}

export default function FeaturedMatchTemplate({ subject, copy }: Props) {
  // Split gradient: player-side type color on the left, opponent's on
  // the right. Each side darkens vertically so the bottom reads denser
  // (good for big white prize digits + handle labels).
  const playerTop = subject.playerAccentColor || "#B0A89E";
  const opponentTop = subject.opponentAccentColor || "#B0A89E";
  const background = `linear-gradient(90deg, ${playerTop} 0%, ${playerTop} 50%, ${opponentTop} 50%, ${opponentTop} 100%)`;
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
        background,
      }}
    >
      {/* Per-side vertical wash */}
      <div style={{ position: "absolute", left: 0, top: 0, width: "50%", height: "100%", background: leftWash }} />
      <div style={{ position: "absolute", left: "50%", top: 0, width: "50%", height: "100%", background: rightWash }} />
      {/* Bottom darken overlay for legibility */}
      <div style={{ position: "absolute", inset: 0, background: overlay }} />

      {/* Eyebrow */}
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

      {/* Prize counts — large flanking digits */}
      <span
        style={{
          position: "absolute",
          left: 60,
          top: 980,
          transform: "translateY(-50%)",
          fontSize: 240,
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
          position: "absolute",
          right: 60,
          top: 980,
          transform: "translateY(-50%)",
          fontSize: 240,
          fontWeight: 900,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
          textShadow: "0 8px 28px rgba(0,0,0,0.45)",
        }}
      >
        {subject.opponentPrizes}
      </span>

      {/* Versus cards — player tilts in from the left, opponent from the
          right, meeting at center. Mirrors the /battles versus layout. */}
      <div
        style={{
          position: "absolute",
          top: 720,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 40,
        }}
      >
        <div
          style={{
            transform: "rotate(-8deg)",
            transformOrigin: "bottom center",
            width: 380,
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
            transformOrigin: "bottom center",
            width: 380,
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

      {/* VS glyph between cards */}
      <span
        style={{
          position: "absolute",
          left: "50%",
          top: 1180,
          transform: "translate(-50%, -50%)",
          fontSize: 64,
          fontWeight: 900,
          letterSpacing: "0.2em",
          color: "rgba(255,255,255,0.9)",
          textShadow: "0 4px 16px rgba(0,0,0,0.45)",
        }}
      >
        VS
      </span>

      {/* TCG Live handles — labelled, one per side, anchored below cards */}
      <div
        style={{
          position: "absolute",
          top: 1380,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "space-between",
          padding: "0 80px",
          alignItems: "flex-start",
        }}
      >
        <div style={{ width: "45%", textAlign: "center" }}>
          <div
            style={{
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: "0.25em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.7)",
              marginBottom: 12,
            }}
          >
            TCG Live
          </div>
          <div
            style={{
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
        </div>
        <div style={{ width: "45%", textAlign: "center" }}>
          <div
            style={{
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: "0.25em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.7)",
              marginBottom: 12,
            }}
          >
            TCG Live
          </div>
          <div
            style={{
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
      </div>

      {/* Site mark — pinned bottom-center; replaces the prior CTA chip */}
      <div
        style={{
          position: "absolute",
          bottom: 80,
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
