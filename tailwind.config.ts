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
        "gradient-brand":         "linear-gradient(90deg, #D99B29 0%, #8C2711 100%)",
        "gradient-brand-reverse": "linear-gradient(90deg, #8C2711 0%, #D99B29 100%)",
      },
      boxShadow: {
        "brand":    "0 4px 20px -4px rgba(140,39,17,0.35)",
        "brand-lg": "0 20px 60px -15px rgba(140,39,17,0.25)",
      },
    },
  },
  plugins: [],
};

export default config;
