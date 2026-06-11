import { shade } from "@/lib/color";
import { CANVAS_H, CANVAS_W, type FeaturedDeckSubject, type TemplateCopy } from "./types";

interface Props {
  subject: FeaturedDeckSubject;
  copy: TemplateCopy;
}

export default function FeaturedDeckTemplate({ subject, copy }: Props) {
  const accent = subject.accentColor || "#B0A89E";
  const gradient = `linear-gradient(180deg, ${shade(accent, -10)} 0%, ${shade(accent, -45)} 100%)`;

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

      {/* Cover art — slightly tilted */}
      {subject.coverImageUrl && (
        <div
          style={{
            position: "absolute",
            top: 240,
            left: "50%",
            transform: "translateX(-50%) rotate(-3deg)",
            width: 640,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={subject.coverImageUrl}
            alt={subject.name}
            style={{
              width: "100%",
              height: "auto",
              borderRadius: 24,
              boxShadow: "0 30px 60px rgba(0,0,0,0.45)",
            }}
          />
        </div>
      )}

      {/* Headline (deck name) */}
      <div
        style={{
          position: "absolute",
          top: 1240,
          left: 60,
          right: 60,
          textAlign: "center",
          fontSize: 88,
          fontWeight: 800,
          letterSpacing: "-0.02em",
          lineHeight: 1.05,
          textShadow: "0 4px 24px rgba(0,0,0,0.3)",
        }}
      >
        {copy.headline}
      </div>

      {/* Subhead */}
      <div
        style={{
          position: "absolute",
          top: 1440,
          left: 100,
          right: 100,
          textAlign: "center",
          fontSize: 36,
          fontWeight: 500,
          lineHeight: 1.35,
          color: "rgba(255,255,255,0.92)",
        }}
      >
        {copy.subhead}
      </div>

      {/* Stats row */}
      <div
        style={{
          position: "absolute",
          top: 1620,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          gap: 48,
          color: "rgba(255,255,255,0.85)",
          fontSize: 32,
          fontWeight: 600,
        }}
      >
        {subject.price !== null && <span>${subject.price.toFixed(0)}</span>}
        <span>♥ {subject.likeCount}</span>
        <span>@{subject.username}</span>
      </div>

      {/* CTA */}
      <div
        style={{
          position: "absolute",
          bottom: 100,
          left: 0,
          right: 0,
          textAlign: "center",
        }}
      >
        <span
          style={{
            display: "inline-block",
            padding: "26px 64px",
            borderRadius: 999,
            background: "#000",
            color: "#fff",
            fontSize: 36,
            fontWeight: 700,
          }}
        >
          {copy.cta}
        </span>
        <div
          style={{
            marginTop: 28,
            fontSize: 26,
            fontWeight: 600,
            color: "rgba(255,255,255,0.75)",
            letterSpacing: "0.05em",
          }}
        >
          tcgdexter.com/u/{subject.username}/{subject.id}
        </div>
      </div>
    </div>
  );
}
