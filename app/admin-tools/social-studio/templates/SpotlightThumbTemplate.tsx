import { shade } from "@/lib/color";
import { pokemonSlug } from "@/lib/primaryCardImage";
import LayerCanvas from "./LayerCanvas";
import {
  proxied,
  THUMB_CANVAS_H,
  THUMB_CANVAS_W,
  type SpotlightThumbSubject,
  type StudioLayer,
  type TemplateCopy,
} from "./types";

const SPRITE_BASE = "https://r2.limitlesstcg.net/pokemon/gen9";

interface Props {
  subject: SpotlightThumbSubject;
  copy: TemplateCopy;
}

/** Two-letter monogram. Mirrors SpotlightTemplate / SpotlightHeader. */
function monogramFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}

/**
 * Flashy 5:4 (1350×1080) thumbnail for a published trainer spotlight. Text
 * column on the left, the partner Pokémon as a big glowing hero on the right.
 * Repurposes the same SpotlightSubject data the 9:16 portrait template uses.
 */
export function buildSpotlightThumbLayers(
  subject: SpotlightThumbSubject,
  copy: TemplateCopy,
): StudioLayer[] {
  const stops = subject.accentColors.length
    ? subject.accentColors
    : ["#B0A89E", "#B0A89E", "#B0A89E"];
  const gradient = `linear-gradient(120deg, ${stops
    .map((c, i) => `${c} ${Math.round((i / Math.max(stops.length - 1, 1)) * 100)}%`)
    .join(", ")})`;
  const avatarGradient = `linear-gradient(180deg, ${stops[0]} 0%, ${shade(stops[0], -22)} 100%)`;
  const accent = stops[0];
  const monogram = monogramFor(subject.displayName);

  // Hero sprite occupies the right ~45% of the canvas; its glow centers here.
  const spriteCx = THUMB_CANVAS_W - 320;
  const spriteCy = THUMB_CANVAS_H / 2;

  const layers: StudioLayer[] = [
    {
      id: "background",
      name: "Background",
      node: (
        <>
          <div style={{ position: "absolute", inset: 0, background: gradient }} />
          {/* Left darken so the text column reads against the gradient. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(90deg, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0.12) 46%, rgba(0,0,0,0) 70%)",
            }}
          />
          {/* Bottom + top vignette for depth. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(180deg, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0) 28%, rgba(0,0,0,0) 70%, rgba(0,0,0,0.32) 100%)",
            }}
          />
        </>
      ),
    },
    {
      id: "glow",
      name: "Hero Glow",
      node: (
        <>
          {/* Colored accent burst. */}
          <div
            style={{
              position: "absolute",
              left: spriteCx - 470,
              top: spriteCy - 470,
              width: 940,
              height: 940,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${accent} 0%, rgba(0,0,0,0) 60%)`,
              opacity: 0.5,
            }}
          />
          {/* Bright white core glow so the sprite pops. */}
          <div
            style={{
              position: "absolute",
              left: spriteCx - 360,
              top: spriteCy - 360,
              width: 720,
              height: 720,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0) 62%)",
            }}
          />
        </>
      ),
    },
  ];

  if (subject.pokemonName) {
    layers.push({
      id: "partner",
      name: "Partner Pokémon",
      node: (
        <div
          style={{
            position: "absolute",
            left: spriteCx - 330,
            top: spriteCy - 350,
            width: 660,
            height: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={proxied(`${SPRITE_BASE}/${pokemonSlug(subject.pokemonName)}.png`)}
            alt={subject.pokemonName}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              filter: "drop-shadow(0 28px 46px rgba(0,0,0,0.45))",
            }}
          />
        </div>
      ),
    });
  }

  layers.push(
    {
      id: "eyebrow",
      name: "Eyebrow",
      copyField: "eyebrow",
      node: (
        <div
          style={{
            position: "absolute",
            top: 96,
            left: 96,
            right: 560,
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: "0.32em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.92)",
            textShadow: "0 2px 12px rgba(0,0,0,0.35)",
          }}
        >
          {copy.eyebrow}
        </div>
      ),
    },
    {
      id: "avatar",
      name: "Avatar",
      node: (
        <div
          style={{
            position: "absolute",
            top: 156,
            left: 96,
            display: "flex",
            alignItems: "center",
            gap: 22,
          }}
        >
          <div
            style={{
              width: 118,
              height: 118,
              borderRadius: "50%",
              border: "6px solid rgba(255,255,255,0.92)",
              overflow: "hidden",
              background: subject.avatarUrl ? undefined : avatarGradient,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
              flexShrink: 0,
            }}
          >
            {subject.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={proxied(subject.avatarUrl)}
                alt={subject.displayName}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <span style={{ fontSize: 54, fontWeight: 900, color: "#fff" }}>
                {monogram}
              </span>
            )}
          </div>
          <span
            style={{
              fontSize: 40,
              fontWeight: 700,
              letterSpacing: "0.02em",
              color: "rgba(255,255,255,0.92)",
              textShadow: "0 2px 12px rgba(0,0,0,0.35)",
            }}
          >
            @{subject.username}
          </span>
        </div>
      ),
    },
    {
      id: "headline",
      name: "Headline",
      copyField: "headline",
      node: (
        <div
          style={{
            position: "absolute",
            top: 320,
            left: 96,
            width: 720,
            fontSize: 118,
            fontWeight: 900,
            letterSpacing: "-0.02em",
            lineHeight: 0.98,
            textShadow: "0 6px 28px rgba(0,0,0,0.4)",
          }}
        >
          {copy.headline}
        </div>
      ),
    },
    {
      id: "accent-rule",
      name: "Accent Rule",
      node: (
        <div
          style={{
            position: "absolute",
            top: 560,
            left: 100,
            width: 132,
            height: 12,
            borderRadius: 999,
            background: accent,
            boxShadow: `0 0 24px ${accent}`,
          }}
        />
      ),
    },
    {
      id: "subhead",
      name: "Subhead",
      copyField: "subhead",
      node: (
        <div
          style={{
            position: "absolute",
            top: 606,
            left: 96,
            width: 690,
            fontSize: 36,
            fontStyle: "italic",
            fontWeight: 500,
            lineHeight: 1.32,
            color: "rgba(255,255,255,0.92)",
            textShadow: "0 2px 12px rgba(0,0,0,0.3)",
          }}
        >
          {copy.subhead}
        </div>
      ),
    },
    {
      id: "cta",
      name: "CTA",
      copyField: "cta",
      node: (
        <div style={{ position: "absolute", bottom: 84, left: 96 }}>
          {copy.cta && (
            <span
              style={{
                display: "inline-block",
                padding: "20px 46px",
                borderRadius: 999,
                background: "#000",
                color: "#fff",
                fontSize: 32,
                fontWeight: 700,
                letterSpacing: "0.01em",
              }}
            >
              {copy.cta}
            </span>
          )}
          <div
            style={{
              marginTop: 22,
              fontSize: 27,
              fontWeight: 600,
              color: "rgba(255,255,255,0.8)",
              letterSpacing: "0.04em",
            }}
          >
            tcgdexter.com/spotlight/{subject.slug}
          </div>
        </div>
      ),
    },
  );

  return layers;
}

export default function SpotlightThumbTemplate({ subject, copy }: Props) {
  return (
    <LayerCanvas
      layers={buildSpotlightThumbLayers(subject, copy)}
      width={THUMB_CANVAS_W}
      height={THUMB_CANVAS_H}
    />
  );
}
