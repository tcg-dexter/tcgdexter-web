import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "TCG Dexter — Pokémon TCG";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#fdf8f2",
          fontFamily: "serif",
          position: "relative",
        }}
      >
        {/* Top accent bar */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "8px",
            backgroundColor: "#c0392b",
          }}
        />

        {/* Card frame */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#f5ede0",
            border: "2px solid #ecdcc8",
            borderRadius: "24px",
            padding: "64px 80px",
            gap: "20px",
          }}
        >
          {/* Red dot accent */}
          <div
            style={{
              width: "16px",
              height: "16px",
              borderRadius: "50%",
              backgroundColor: "#c0392b",
              marginBottom: "8px",
            }}
          />

          {/* Wordmark */}
          <div
            style={{
              fontSize: "96px",
              fontWeight: "700",
              color: "#2c1f0e",
              letterSpacing: "-2px",
              lineHeight: 1,
            }}
          >
            Dexter
          </div>

          {/* Tagline */}
          <div
            style={{
              fontSize: "32px",
              color: "#8b6040",
              letterSpacing: "2px",
              textTransform: "uppercase",
              marginTop: "4px",
            }}
          >
            Pokémon Cards · Competitive Insight · Community
          </div>

          {/* URL */}
          <div
            style={{
              fontSize: "24px",
              color: "#b89d7e",
              marginTop: "16px",
            }}
          >
            tcgdexter.com
          </div>
        </div>

        {/* Bottom accent bar */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "8px",
            backgroundColor: "#c0392b",
          }}
        />
      </div>
    ),
    { ...size }
  );
}
