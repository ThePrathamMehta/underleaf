import type { Config } from "tailwindcss";

/**
 * Tailwind styles the app chrome only. Resume documents are styled by
 * themeToCss in @repo/ui and must stay outside Tailwind's reach.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: "var(--paper)",
          raised: "var(--paper-raised)",
          sunken: "var(--paper-sunken)",
        },
        ink: {
          DEFAULT: "var(--ink)",
          muted: "var(--ink-muted)",
          faint: "var(--ink-faint)",
        },
        rule: {
          DEFAULT: "var(--rule)",
          strong: "var(--rule-strong)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          wash: "var(--accent-wash)",
          ring: "var(--accent-ring)",
        },
        positive: { DEFAULT: "var(--positive)", wash: "var(--positive-wash)" },
        danger: { DEFAULT: "var(--danger)", wash: "var(--danger-wash)" },
        canvas: { DEFAULT: "var(--canvas)", grid: "var(--canvas-grid)" },
      },
      fontFamily: {
        // Wired to next/font in app/layout.tsx.
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "var(--shadow-card)",
        lift: "var(--shadow-lift)",
        page: "var(--shadow-page)",
      },
      letterSpacing: {
        tightest: "-0.03em",
      },
    },
  },
  plugins: [],
};

export default config;
