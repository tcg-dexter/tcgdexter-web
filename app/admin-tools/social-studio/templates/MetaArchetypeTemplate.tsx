import { shade } from "@/lib/color";
import LayerCanvas from "./LayerCanvas";
import { CtaBlock, Eyebrow, SectionLabel, STAT_DIGIT_STYLE } from "./chrome";
import {
  proxied,
  type MetaArchetypeSubject,
  type StudioLayer,
  type TemplateCopy,
} from "./types";

interface Props {
  subject: MetaArchetypeSubject;
  copy: TemplateCopy;
}

export function buildMetaArchetypeLayers(
  subject: MetaArchetypeSubject,
  copy: TemplateCopy,
): StudioLayer[] {
  const accent = subject.accentColor || "#B0A89E";
  const gradient = `linear-gradient(165deg, ${accent} 0%, ${shade(accent, -30)} 100%)`;

  return [
    {
      id: "background",
      name: "Background",
      node: (
        <>
          <div style={{ position: "absolute", inset: 0, background: gradient }} />
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
      node: <Eyebrow text={copy.eyebrow} top={130} />,
    },
    {
      id: "hero-card",
      name: "Hero Card",
      node: (
        <div
          style={{
            position: "absolute",
            top: 220,
            left: "50%",
            transform: "translateX(-50%) rotate(-4deg)",
            width: 680,
            height: 950,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {subject.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={proxied(subject.imageUrl)}
              alt={subject.name}
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                borderRadius: 24,
                boxShadow: "0 30px 60px rgba(0,0,0,0.45)",
              }}
            />
          ) : subject.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={proxied(subject.iconUrl)}
              alt={subject.name}
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                filter: "drop-shadow(0 20px 40px rgba(0,0,0,0.45))",
              }}
            />
          ) : null}
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
            top: 1240,
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
      // The hero stat — meta share in the Featured Battle's giant-digit
      // voice, with the entry count as supporting context.
      id: "meta-share",
      name: "Meta Share",
      node: (
        <>
          <SectionLabel text="Meta Share" top={1410} />
          <div
            style={{
              ...STAT_DIGIT_STYLE,
              position: "absolute",
              top: 1490,
              left: 0,
              right: 0,
              fontSize: 160,
            }}
          >
            {subject.representationPct.toFixed(1)}%
          </div>
          <div
            style={{
              position: "absolute",
              top: 1670,
              left: 0,
              right: 0,
              textAlign: "center",
              fontSize: 30,
              fontWeight: 600,
              color: "rgba(255,255,255,0.85)",
              textShadow: "0 2px 12px rgba(0,0,0,0.3)",
            }}
          >
            {subject.totalEntries.toLocaleString()} tournament entries tracked
          </div>
        </>
      ),
    },
    {
      id: "cta",
      name: "CTA",
      copyField: "cta",
      node: (
        <CtaBlock cta={copy.cta} url="tcgdexter.com/meta-archetypes" bottom={50} />
      ),
    },
  ];
}

export default function MetaArchetypeTemplate({ subject, copy }: Props) {
  return <LayerCanvas layers={buildMetaArchetypeLayers(subject, copy)} />;
}
