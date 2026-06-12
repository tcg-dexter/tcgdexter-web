import { shade } from "@/lib/color";
import { pokemonSlug } from "@/lib/primaryCardImage";
import LayerCanvas from "./LayerCanvas";
import { CtaBlock, Eyebrow, SectionLabel } from "./chrome";
import {
  proxied,
  type SpotlightSubject,
  type StudioLayer,
  type TemplateCopy,
} from "./types";

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

export function buildSpotlightLayers(
  subject: SpotlightSubject,
  copy: TemplateCopy,
): StudioLayer[] {
  const stops = subject.accentColors.length
    ? subject.accentColors
    : ["#B0A89E", "#B0A89E", "#B0A89E"];
  const gradient = `linear-gradient(180deg, ${stops
    .map((c, i) => `${c} ${Math.round((i / Math.max(stops.length - 1, 1)) * 100)}%`)
    .join(", ")})`;
  const avatarGradient = `linear-gradient(180deg, ${stops[0]} 0%, ${shade(stops[0], -22)} 100%)`;
  const monogram = monogramFor(subject.displayName);

  const layers: StudioLayer[] = [
    {
      id: "background",
      name: "Background",
      node: (
        <>
          <div style={{ position: "absolute", inset: 0, background: gradient }} />
          {/* Bottom darken so the sprite + CTA zone reads denser. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(0,0,0,0.3) 100%)",
            }}
          />
        </>
      ),
    },
    {
      id: "eyebrow",
      name: "Eyebrow",
      copyField: "eyebrow",
      node: <Eyebrow text={copy.eyebrow} />,
    },
    {
      id: "avatar",
      name: "Avatar",
      node: (
        <>
          <div
            style={{
              position: "absolute",
              top: 210,
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
                src={proxied(subject.avatarUrl)}
                alt={subject.displayName}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <span style={{ fontSize: 130, fontWeight: 900, color: "#fff" }}>
                {monogram}
              </span>
            )}
          </div>
          <div
            style={{
              position: "absolute",
              top: 516,
              left: 0,
              right: 0,
              textAlign: "center",
              fontSize: 30,
              fontWeight: 700,
              letterSpacing: "0.05em",
              color: "rgba(255,255,255,0.85)",
              textShadow: "0 2px 12px rgba(0,0,0,0.3)",
            }}
          >
            @{subject.username}
          </div>
        </>
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
            top: 590,
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
            top: 820,
            left: 100,
            right: 100,
            textAlign: "center",
            fontSize: 36,
            fontStyle: "italic",
            fontWeight: 500,
            lineHeight: 1.35,
            color: "rgba(255,255,255,0.92)",
            textShadow: "0 2px 12px rgba(0,0,0,0.25)",
          }}
        >
          {copy.subhead}
        </div>
      ),
    },
  ];

  if (subject.pokemonName) {
    layers.push({
      id: "partner",
      name: "Partner Pokémon",
      node: (
        <>
          <SectionLabel text="Partner Pokémon" top={1030} fontSize={36} />
          {/* Soft glow disc so the sprite pops off the gradient. */}
          <div
            style={{
              position: "absolute",
              top: 1010,
              left: "50%",
              transform: "translateX(-50%)",
              width: 720,
              height: 720,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 65%)",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 1110,
              left: "50%",
              transform: "translateX(-50%)",
              width: 540,
              height: 540,
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
                filter: "drop-shadow(0 20px 40px rgba(0,0,0,0.35))",
              }}
            />
          </div>
        </>
      ),
    });
  }

  layers.push({
    id: "cta",
    name: "CTA",
    copyField: "cta",
    node: (
      <CtaBlock
        cta={copy.cta}
        url={`tcgdexter.com/spotlight/${subject.slug}`}
        bottom={120}
      />
    ),
  });

  return layers;
}

export default function SpotlightTemplate({ subject, copy }: Props) {
  return <LayerCanvas layers={buildSpotlightLayers(subject, copy)} />;
}
