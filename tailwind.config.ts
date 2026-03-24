import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Deep dark backgrounds
        navy: {
          900: "#0a0e1a",
          800: "#111827",
          700: "#1a2236",
        },
        // TCG energy accent — warm red-orange
        energy: {
          DEFAULT: "#e84545",
          light: "#ff6b6b",
          dark: "#c23030",
        },
        // Muted text
        slate: {
          400: "#94a3b8",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)"],
        mono: ["var(--font-geist-mono)"],
      },
    },
  },
  plugins: [],
};

export default config;
