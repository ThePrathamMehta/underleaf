import type { Config } from "tailwindcss";

/**
 * The design tokens are CSS custom properties holding whole colours (`#faf7f2`),
 * so Tailwind can't parse them and silently drops every alpha modifier —
 * `bg-paper/85` compiled to nothing at all, which left the sticky headers with
 * no background rather than a translucent one. Resolving through color-mix
 * restores the modifiers without splitting the tokens into channel triplets,
 * which would mean rewriting every plain `var(--paper)` in the CSS too.
 *
 * Without a modifier this still resolves to a bare `var(--token)`.
 */
type ColorResolver = (options: { opacityValue?: string }) => string;

function token(name: string): string {
  const resolve: ColorResolver = ({ opacityValue }) =>
    opacityValue === undefined
      ? `var(${name})`
      : `color-mix(in srgb, var(${name}) calc(${opacityValue} * 100%), transparent)`;

  // Tailwind accepts a resolver function here at runtime; its exported `Config`
  // type only admits strings, hence the cast.
  return resolve as unknown as string;
}

/**
 * Tailwind styles the app chrome only. Resume documents are styled by
 * themeToCss in @repo/ui and must stay outside Tailwind's reach.
 */
const config: Config = {
  // Class strategy (not media) so the in-app toggle can override the OS default.
  // The token values themselves flip under `.dark` in tokens.css, so existing
  // `bg-paper`/`text-ink`/… utilities become dark-aware with no per-component
  // `dark:` variants.
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: token("--paper"),
          raised: token("--paper-raised"),
          sunken: token("--paper-sunken"),
        },
        ink: {
          DEFAULT: token("--ink"),
          muted: token("--ink-muted"),
          faint: token("--ink-faint"),
        },
        rule: {
          DEFAULT: token("--rule"),
          strong: token("--rule-strong"),
        },
        accent: {
          DEFAULT: token("--accent"),
          hover: token("--accent-hover"),
          wash: token("--accent-wash"),
          ring: token("--accent-ring"),
        },
        positive: { DEFAULT: token("--positive"), wash: token("--positive-wash") },
        danger: { DEFAULT: token("--danger"), wash: token("--danger-wash") },
        canvas: { DEFAULT: token("--canvas"), grid: token("--canvas-grid") },
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
