import { shade } from "@/lib/color";
import { pokemonSlug } from "@/lib/primaryCardImage";
import { CANVAS_H, CANVAS_W, type SpotlightSubject, type TemplateCopy } from "./types";

const SPRITE_BASE = "https://r2.limitlesstcg.net/pokemon/gen9";

interface Props {
  subject: SpotlightSubject;
  copy: TemplateCopy;
}

/** Two-letter monogram. Mirrors SpotlightHeader's helper. */
function monogramFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}

export default function SpotlightTemplate({ subject, copy }: Props) {
  const stops = subject.accentColors.length
    ? subject.accentColors
    : ["#B0A89E", "#B0A89E", "#B0A89E"];
  const gradient = `linear-gradient(180deg, ${stops
    .map((c, i) => `${c} ${Math.round((i / Math.max(stops.length - 1, 1)) * 100)}%`)
    .join(", ")})`;
  const avatarGradient = `linear-gradient(180deg, ${stops[0]} 0%, ${shade(stops[0], -22)} 100%)`;
  const monogram = monogramFor(subject.displayName);

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

      {/* Avatar */}
      <div
        style={{
          position: "absolute",
          top: 220,
          left: "50%",
          transform: "translateX(-50%)",
          width: 280,
          height: 280,
          borderRadius: "50%",
          border: "8px solid rgba(255,255,255,0.9)",
          overflow: "hidden",
          background: subject.avatarUrl ? undefined : avatarGradient,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
        }}
      >
        {subject.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={subject.avatarUrl}
            alt={subject.displayName}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <span style={{ fontSize: 130, fontWeight: 900, color: "#fff" }}>{monogram}</span>
        )}
      </div>

      {/* Headline */}
      <div
        style={{
          position: "absolute",
          top: 560,
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

      {/* Subhead */}
      <div
        style={{
          position: "absolute",
          top: 800,
          left: 100,
          right: 100,
          textAlign: "center",
          fontSize: 36,
          fontStyle: "italic",
          fontWeight: 500,
          lineHeight: 1.35,
          color: "rgba(255,255,255,0.92)",
        }}
      >
        {copy.subhead}
      </div>

      {/* Center Pokémon sprite — anchored bottom-center */}
      {subject.pokemonName && (
        <div
          style={{
            position: "absolute",
            bottom: 260,
            left: "50%",
            transform: "translateX(-50%)",
            width: 560,
            height: 560,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${SPRITE_BASE}/${pokemonSlug(subject.pokemonName)}.png`}
            alt={subject.pokemonName}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              filter: "drop-shadow(0 20px 40px rgba(0,0,0,0.35))",
            }}
          />
        </div>
      )}

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
            letterSpacing: "0.01em",
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
          tcgdexter.com/spotlight/{subject.slug}
        </div>
      </div>
    </div>
  );
}
