import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#fdf8f2",
          borderRadius: "112px",
        }}
      >
        {/* Red accent dot top */}
        <div
          style={{
            position: "absolute",
            top: "72px",
            width: "28px",
            height: "28px",
            borderRadius: "50%",
            backgroundColor: "#c0392b",
          }}
        />
        {/* D lettermark */}
        <div
          style={{
            fontSize: "320px",
            fontWeight: "700",
            color: "#2c1f0e",
            lineHeight: 1,
            letterSpacing: "-8px",
            marginTop: "20px",
          }}
        >
          D
        </div>
      </div>
    ),
    { ...size }
  );
}
