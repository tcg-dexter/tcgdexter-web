import { shade } from "@/lib/color";
import LayerCanvas from "./LayerCanvas";
import { CtaBlock, Eyebrow } from "./chrome";
import {
  proxied,
  type FeaturedDeckSubject,
  type StudioLayer,
  type TemplateCopy,
} from "./types";

interface Props {
  subject: FeaturedDeckSubject;
  copy: TemplateCopy;
}

export function buildFeaturedDeckLayers(
  subject: FeaturedDeckSubject,
  copy: TemplateCopy,
): StudioLayer[] {
  const accent = subject.accentColor || "#B0A89E";
  const gradient = `linear-gradient(180deg, ${shade(accent, -10)} 0%, ${shade(accent, -45)} 100%)`;

  const layers: StudioLayer[] = [
    {
      id: "background",
      name: "Background",
      node: <div style={{ position: "absolute", inset: 0, background: gradient }} />,
    },
    {
      id: "eyebrow",
      name: "Eyebrow",
      copyField: "eyebrow",
      node: <Eyebrow text={copy.eyebrow} />,
    },
  ];

  if (subject.coverImageUrl) {
    layers.push({
      id: "cover-art",
      name: "Cover Art",
      node: (
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
            src={proxied(subject.coverImageUrl)}
            alt={subject.name}
            style={{
              width: "100%",
              height: "auto",
              display: "block",
              borderRadius: 24,
              boxShadow: "0 30px 60px rgba(0,0,0,0.45)",
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
      ),
    },
    {
      id: "stats",
      name: "Stats Row",
      node: (
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
      ),
    },
    {
      id: "cta",
      name: "CTA",
      copyField: "cta",
      node: (
        <CtaBlock
          cta={copy.cta}
          url={`tcgdexter.com/u/${subject.username}/${subject.id}`}
          bottom={100}
        />
      ),
    },
  );

  return layers;
}

export default function FeaturedDeckTemplate({ subject, copy }: Props) {
  return <LayerCanvas layers={buildFeaturedDeckLayers(subject, copy)} />;
}
