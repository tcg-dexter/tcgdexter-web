import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Semantic design tokens (mapped to CSS custom properties)
        bg:      "var(--bg)",
        surface: { DEFAULT: "var(--surface)", 2: "var(--surface-2)", elevated: "var(--surface-elevated)" },
        border:  "var(--border)",
        "text-primary":   "var(--text-primary)",
        "text-secondary": "var(--text-secondary)",
        "text-muted":     "var(--text-muted)",
        accent: {
          DEFAULT: "var(--accent)",
          light:   "var(--accent-light)",
          dark:    "var(--accent-dark)",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)"],
        mono: ["var(--font-geist-mono)"],
      },
      backgroundImage: {
        "gradient-brand":         "linear-gradient(90deg, #F2A20C 0%, #D91E0D 50%, #A60D0D 100%)",
        "gradient-brand-reverse": "linear-gradient(90deg, #A60D0D 0%, #D91E0D 50%, #F2A20C 100%)",
      },
      boxShadow: {
        "brand":    "0 4px 20px -4px rgba(217,30,13,0.35)",
        "brand-lg": "0 20px 60px -15px rgba(217,30,13,0.25)",
      },
    },
  },
  plugins: [],
};

export default config;
