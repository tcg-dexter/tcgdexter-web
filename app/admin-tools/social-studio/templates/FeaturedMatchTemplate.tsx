import { shade } from "@/lib/color";
import { CANVAS_H, CANVAS_W, type FeaturedMatchSubject, type TemplateCopy } from "./types";

interface Props {
  subject: FeaturedMatchSubject;
  copy: TemplateCopy;
}

export default function FeaturedMatchTemplate({ subject, copy }: Props) {
  const accent = subject.accentColor || "#B0A89E";
  const gradient = `linear-gradient(180deg, ${accent} 0%, ${shade(accent, -40)} 100%)`;
  const resultLabel =
    subject.result === "win" ? "W" : subject.result === "loss" ? "L" : "T";
  const resultColor =
    subject.result === "win"
      ? "#10b981"
      : subject.result === "loss"
      ? "#ef4444"
      : "#6b7280";

  return (
    <div
      style={{
        width: CANVAS_W,
        height: CANVAS_H,
        background: gradient,
        position: "relative",
        overflow: "hidden",
        fontFamily: "var(--font-sans, system-ui)",
        color: "#fff",
      }}
    >
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
          color: "rgba(255,255,255,0.85)",
        }}
      >
        {copy.eyebrow}
      </div>

      {/* Result badge */}
      <div
        style={{
          position: "absolute",
          top: 220,
          left: "50%",
          transform: "translateX(-50%)",
          width: 200,
          height: 200,
          borderRadius: "50%",
          background: resultColor,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 130,
          fontWeight: 900,
          boxShadow: "0 20px 50px rgba(0,0,0,0.35)",
        }}
      >
        {resultLabel}
      </div>

      {/* Prize counts — flanking big numbers */}
      <div
        style={{
          position: "absolute",
          top: 520,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: 80,
          fontSize: 200,
          fontWeight: 900,
          fontVariantNumeric: "tabular-nums",
          textShadow: "0 6px 24px rgba(0,0,0,0.3)",
        }}
      >
        <span>{subject.playerPrizes}</span>
        <span style={{ fontSize: 80, opacity: 0.6 }}>—</span>
        <span style={{ opacity: 0.7 }}>{subject.opponentPrizes}</span>
      </div>

      {/* Player / Opponent labels */}
      <div
        style={{
          position: "absolute",
          top: 800,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          gap: 200,
          fontSize: 32,
          fontWeight: 600,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.8)",
        }}
      >
        <span>@{subject.username}</span>
        <span>{subject.opponentHandle ?? "Opponent"}</span>
      </div>

      {/* Deck cover */}
      {subject.deckCoverUrl && (
        <div
          style={{
            position: "absolute",
            top: 940,
            left: "50%",
            transform: "translateX(-50%) rotate(-3deg)",
            width: 520,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={subject.deckCoverUrl}
            alt={subject.deckName}
            style={{
              width: "100%",
              height: "auto",
              borderRadius: 20,
              boxShadow: "0 30px 60px rgba(0,0,0,0.4)",
            }}
          />
        </div>
      )}

      {/* Headline */}
      <div
        style={{
          position: "absolute",
          top: 1620,
          left: 60,
          right: 60,
          textAlign: "center",
          fontSize: 64,
          fontWeight: 800,
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
          textShadow: "0 4px 24px rgba(0,0,0,0.3)",
        }}
      >
        {copy.headline}
      </div>

      {/* Subhead */}
      <div
        style={{
          position: "absolute",
          top: 1760,
          left: 100,
          right: 100,
          textAlign: "center",
          fontSize: 30,
          fontStyle: "italic",
          fontWeight: 500,
          color: "rgba(255,255,255,0.9)",
        }}
      >
        {copy.subhead}
      </div>

      {/* CTA */}
      <div
        style={{
          position: "absolute",
          bottom: 60,
          left: 0,
          right: 0,
          textAlign: "center",
        }}
      >
        <span
          style={{
            display: "inline-block",
            padding: "22px 56px",
            borderRadius: 999,
            background: "#000",
            color: "#fff",
            fontSize: 32,
            fontWeight: 700,
          }}
        >
          {copy.cta}
        </span>
      </div>
    </div>
  );
}
