import { shade } from "@/lib/color";
import LayerCanvas from "./LayerCanvas";
import { CtaBlock, Eyebrow, SectionLabel, STAT_DIGIT_STYLE } from "./chrome";
import {
  proxied,
  type CardSpotlightSubject,
  type StudioLayer,
  type TemplateCopy,
} from "./types";

interface Props {
  subject: CardSpotlightSubject;
  copy: TemplateCopy;
}

/** Format like the shop surfaces: whole dollars under $1k get cents. */
function formatPrice(price: number): string {
  return price >= 1000
    ? `$${Math.round(price).toLocaleString()}`
    : `$${price.toFixed(2)}`;
}

export function buildCardSpotlightLayers(
  subject: CardSpotlightSubject,
  copy: TemplateCopy,
): StudioLayer[] {
  const accent = subject.accentColor || "#B0A89E";
  const gradient = `linear-gradient(165deg, ${shade(accent, 8)} 0%, ${shade(accent, -34)} 100%)`;

  const layers: StudioLayer[] = [
    {
      id: "background",
      name: "Background",
      node: (
        <>
          <div style={{ position: "absolute", inset: 0, background: gradient }} />
          {/* Glow behind the card art so the foil pops. */}
          <div
            style={{
              position: "absolute",
              top: 160,
              left: "50%",
              transform: "translateX(-50%)",
              width: 900,
              height: 1000,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 65%)",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(180deg, rgba(0,0,0,0) 50%, rgba(0,0,0,0.32) 100%)",
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
  ];

  if (subject.imageUrl) {
    layers.push({
      id: "card-art",
      name: "Card Art",
      node: (
        <div
          style={{
            position: "absolute",
            top: 230,
            left: "50%",
            transform: "translateX(-50%) rotate(-5deg)",
            width: 600,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={proxied(subject.imageUrl)}
            alt={subject.name}
            style={{
              width: "100%",
              height: "auto",
              display: "block",
              borderRadius: 24,
              boxShadow: "0 30px 60px rgba(0,0,0,0.5)",
            }}
          />
        </div>
      ),
    });
  }

  layers.push(
    {
      id: "headline",
      name: "Headline",
      copyField: "headline",
      node: (
        <div
          style={{
            position: "absolute",
            top: 1190,
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
            top: 1330,
            left: 100,
            right: 100,
            textAlign: "center",
            fontSize: 36,
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
  );

  if (subject.artist) {
    layers.push({
      id: "artist",
      name: "Artist Credit",
      node: (
        <div
          style={{
            position: "absolute",
            top: 1400,
            left: 100,
            right: 100,
            textAlign: "center",
            fontSize: 30,
            fontStyle: "italic",
            fontWeight: 500,
            color: "rgba(255,255,255,0.8)",
            textShadow: "0 2px 12px rgba(0,0,0,0.25)",
          }}
        >
          Illus. {subject.artist}
        </div>
      ),
    });
  }

  if (subject.marketPrice !== null) {
    layers.push({
      id: "market-price",
      name: "Market Price",
      node: (
        <>
          <SectionLabel text="Market Price" top={1500} fontSize={38} />
          <div
            style={{
              ...STAT_DIGIT_STYLE,
              position: "absolute",
              top: 1570,
              left: 0,
              right: 0,
              fontSize: 140,
            }}
          >
            {formatPrice(subject.marketPrice)}
          </div>
        </>
      ),
    });
  }

  layers.push({
    id: "cta",
    name: "CTA",
    copyField: "cta",
    node: <CtaBlock cta={copy.cta} url="tcgdexter.com" bottom={50} />,
  });

  return layers;
}

export default function CardSpotlightTemplate({ subject, copy }: Props) {
  return <LayerCanvas layers={buildCardSpotlightLayers(subject, copy)} />;
}
