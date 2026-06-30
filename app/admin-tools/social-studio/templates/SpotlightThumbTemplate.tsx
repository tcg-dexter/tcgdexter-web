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

/**
 * Flashy 5:4 (1350×1080) thumbnail for a published trainer spotlight. Text
 * column on the left (display name as the headline), the trainer's uploaded
 * avatar as a hero portrait on the right with the partner Pokémon popping in
 * front. Repurposes the same SpotlightSubject data the 9:16 template uses.
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
  const accent = stops[0];

  // Right-side hero cluster: the trainer's uploaded avatar as a big portrait,
  // with the partner Pokémon popping in front of it and offset down-left.
  const avatarD = 480;
  const avatarCx = 1052;
  const avatarCy = 398;
  const spriteBox = 470;
  const spriteCx = 884;
  const spriteCy = 614;
  // Text column lives to the left of the hero cluster.
  const COL_LEFT = 92;
  const COL_W = 540;

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
                "linear-gradient(90deg, rgba(0,0,0,0.46) 0%, rgba(0,0,0,0.14) 44%, rgba(0,0,0,0) 66%)",
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
          {/* Colored accent burst behind the cluster. */}
          <div
            style={{
              position: "absolute",
              left: 990 - 500,
              top: 470 - 500,
              width: 1000,
              height: 1000,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${accent} 0%, rgba(0,0,0,0) 60%)`,
              opacity: 0.5,
            }}
          />
          {/* Bright white core glow so the cluster pops. */}
          <div
            style={{
              position: "absolute",
              left: 990 - 380,
              top: 470 - 380,
              width: 760,
              height: 760,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0) 62%)",
            }}
          />
        </>
      ),
    },
  ];

  // Trainer's uploaded avatar as the hero portrait. Only shown when one is
  // set — no monogram fallback.
  if (subject.avatarUrl) {
    layers.push({
      id: "trainer",
      name: "Trainer Avatar",
      node: (
        <div
          style={{
            position: "absolute",
            left: avatarCx - avatarD / 2,
            top: avatarCy - avatarD / 2,
            width: avatarD,
            height: avatarD,
            borderRadius: "50%",
            border: "10px solid rgba(255,255,255,0.94)",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 24px 60px rgba(0,0,0,0.4)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={proxied(subject.avatarUrl)}
            alt={subject.displayName}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
      ),
    });
  }

  if (subject.pokemonName) {
    layers.push({
      id: "partner",
      name: "Partner Pokémon",
      node: (
        <div
          style={{
            position: "absolute",
            left: spriteCx - spriteBox / 2,
            top: spriteCy - spriteBox / 2,
            width: spriteBox,
            height: spriteBox,
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
              // Fill the hero box (objectFit keeps aspect). maxWidth/maxHeight
              // alone never upscale, so small sprites would render tiny.
              width: "100%",
              height: "100%",
              objectFit: "contain",
              filter: "drop-shadow(0 28px 46px rgba(0,0,0,0.5))",
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
            top: 120,
            left: COL_LEFT,
            width: COL_W,
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: "0.3em",
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
      id: "headline",
      name: "Headline",
      copyField: "headline",
      node: (
        <div
          style={{
            position: "absolute",
            top: 196,
            left: COL_LEFT,
            width: COL_W,
            fontSize: 100,
            fontWeight: 900,
            letterSpacing: "-0.02em",
            lineHeight: 0.98,
            textShadow: "0 6px 28px rgba(0,0,0,0.42)",
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
            top: 446,
            left: COL_LEFT + 4,
            width: 124,
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
            top: 490,
            left: COL_LEFT,
            width: COL_W - 10,
            fontSize: 34,
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
        <div style={{ position: "absolute", bottom: 84, left: COL_LEFT }}>
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
