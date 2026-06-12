/** Shared on-canvas building blocks so every template speaks the same
 *  design language as the Featured Match reference: tracked-out section
 *  labels, the eyebrow, giant stat digits, and the CTA pill + URL block. */

/** Wide-tracked uppercase label — the "TCG LIVE" / "PRIZES TAKEN" voice. */
export const SECTION_LABEL_STYLE: React.CSSProperties = {
  fontWeight: 800,
  letterSpacing: "0.32em",
  textTransform: "uppercase",
  textShadow: "0 4px 16px rgba(0,0,0,0.4)",
  textAlign: "center",
};

/** Giant stat digits — the prize-count treatment. */
export const STAT_DIGIT_STYLE: React.CSSProperties = {
  fontWeight: 900,
  fontVariantNumeric: "tabular-nums",
  lineHeight: 1,
  textAlign: "center",
  textShadow: "0 8px 28px rgba(0,0,0,0.45)",
};

export function Eyebrow({ text, top = 120 }: { text: string; top?: number }) {
  return (
    <div
      style={{
        position: "absolute",
        top,
        left: 0,
        right: 0,
        textAlign: "center",
        fontSize: 32,
        fontWeight: 600,
        letterSpacing: "0.4em",
        textTransform: "uppercase",
        color: "rgba(255,255,255,0.9)",
        textShadow: "0 2px 12px rgba(0,0,0,0.35)",
      }}
    >
      {text}
    </div>
  );
}

export function SectionLabel({
  text,
  top,
  fontSize = 42,
}: {
  text: string;
  top: number;
  fontSize?: number;
}) {
  return (
    <div
      style={{
        ...SECTION_LABEL_STYLE,
        fontSize,
        position: "absolute",
        top,
        left: 0,
        right: 0,
      }}
    >
      {text}
    </div>
  );
}

/** CTA pill + site URL, pinned to the canvas bottom. */
export function CtaBlock({
  cta,
  url,
  bottom = 120,
}: {
  cta: string;
  url: string;
  bottom?: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        bottom,
        left: 0,
        right: 0,
        textAlign: "center",
      }}
    >
      {cta && (
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
          {cta}
        </span>
      )}
      <div
        style={{
          marginTop: 28,
          fontSize: 28,
          fontWeight: 600,
          color: "rgba(255,255,255,0.78)",
          letterSpacing: "0.05em",
        }}
      >
        {url}
      </div>
    </div>
  );
}
