import { shade } from "@/lib/color";
import { CANVAS_H, CANVAS_W, type MetaArchetypeSubject, type TemplateCopy } from "./types";

interface Props {
  subject: MetaArchetypeSubject;
  copy: TemplateCopy;
}

export default function MetaArchetypeTemplate({ subject, copy }: Props) {
  const accent = subject.accentColor || "#B0A89E";
  const gradient = `linear-gradient(165deg, ${accent} 0%, ${shade(accent, -30)} 100%)`;

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
          top: 130,
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

      {/* Hero card art (or sprite) */}
      <div
        style={{
          position: "absolute",
          top: 220,
          left: "50%",
          transform: "translateX(-50%)",
          width: 720,
          height: 1000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {subject.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={subject.imageUrl}
            alt={subject.name}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              borderRadius: 24,
              boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
            }}
          />
        ) : subject.iconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={subject.iconUrl}
            alt={subject.name}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              filter: "drop-shadow(0 20px 40px rgba(0,0,0,0.45))",
            }}
          />
        ) : null}
      </div>

      {/* Headline (archetype name) */}
      <div
        style={{
          position: "absolute",
          top: 1280,
          left: 60,
          right: 60,
          textAlign: "center",
          fontSize: 96,
          fontWeight: 800,
          letterSpacing: "-0.02em",
          lineHeight: 1.05,
          textShadow: "0 4px 24px rgba(0,0,0,0.3)",
        }}
      >
        {copy.headline}
      </div>

      {/* Subhead — meta share / stat */}
      <div
        style={{
          position: "absolute",
          top: 1480,
          left: 100,
          right: 100,
          textAlign: "center",
          fontSize: 40,
          fontWeight: 500,
          lineHeight: 1.35,
          color: "rgba(255,255,255,0.92)",
        }}
      >
        {copy.subhead}
      </div>

      {/* CTA */}
      <div
        style={{
          position: "absolute",
          bottom: 120,
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
            marginTop: 32,
            fontSize: 28,
            fontWeight: 600,
            color: "rgba(255,255,255,0.75)",
            letterSpacing: "0.05em",
          }}
        >
          tcgdexter.com/meta-archetypes
        </div>
      </div>
    </div>
  );
}
