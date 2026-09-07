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
      borderRadius: {
        // The outer radius of the concentric-corner system: preview cards
        // (battle, deck, archetype, trainer, featured battle), modal and
        // dialog panels, and the home page's deck-list input. Anything
        // circular or capsule-shaped that sits in one of these corners is
        // inset by `card - its own radius` so the two arcs share a center —
        // a 28px badge (r=14) sits 24px in, a 36px capsule (r=18) 20px in,
        // a 40px pill (r=20) 18px in, a 48px avatar (r=24) 14px in. The
        // standard p-6 dialog satisfies this for free: its footer pills are
        // 28px tall and its padding is exactly the 24px they want. See the
        // design library's "Cards & surfaces" and "Modals & dialogs".
        card: "38px",
      },
    },
  },
  plugins: [],
};

export default config;
