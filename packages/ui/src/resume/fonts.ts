import type { Theme } from "@repo/types";

type FontFile = { file: string; weight: 400 | 700; style: "normal" | "italic" };

type FontDefinition = {
  /** The CSS family name used by both render paths. */
  family: string;
  /** npm package the WOFF2 files are copied from by `scripts/sync-fonts.ts`. */
  source: string;
  files: FontFile[];
};

/**
 * The closed set of resume fonts, vendored as WOFF2 so the editor and Puppeteer
 * resolve byte-identical files. Family names are shared across both paths; only
 * the `src` differs (URL in the browser, base64 in the export).
 */
export const FONT_DEFINITIONS: Record<string, FontDefinition> = {
  inter: {
    family: "Underleaf Inter",
    source: "@fontsource/inter",
    files: [
      { file: "inter-400.woff2", weight: 400, style: "normal" },
      { file: "inter-700.woff2", weight: 700, style: "normal" },
    ],
  },
  lato: {
    family: "Underleaf Lato",
    source: "@fontsource/lato",
    files: [
      { file: "lato-400.woff2", weight: 400, style: "normal" },
      { file: "lato-700.woff2", weight: 700, style: "normal" },
      { file: "lato-400-italic.woff2", weight: 400, style: "italic" },
    ],
  },
  roboto: {
    family: "Underleaf Roboto",
    source: "@fontsource/roboto",
    files: [
      { file: "roboto-400.woff2", weight: 400, style: "normal" },
      { file: "roboto-700.woff2", weight: 700, style: "normal" },
      { file: "roboto-400-italic.woff2", weight: 400, style: "italic" },
    ],
  },
  "source-serif": {
    family: "Underleaf Source Serif",
    source: "@fontsource/source-serif-4",
    files: [
      { file: "source-serif-400.woff2", weight: 400, style: "normal" },
      { file: "source-serif-700.woff2", weight: 700, style: "normal" },
      { file: "source-serif-400-italic.woff2", weight: 400, style: "italic" },
    ],
  },
  "eb-garamond": {
    family: "Underleaf EB Garamond",
    source: "@fontsource/eb-garamond",
    files: [
      { file: "eb-garamond-400.woff2", weight: 400, style: "normal" },
      { file: "eb-garamond-700.woff2", weight: 700, style: "normal" },
      { file: "eb-garamond-400-italic.woff2", weight: 400, style: "italic" },
    ],
  },
  merriweather: {
    family: "Underleaf Merriweather",
    source: "@fontsource/merriweather",
    files: [
      { file: "merriweather-400.woff2", weight: 400, style: "normal" },
      { file: "merriweather-700.woff2", weight: 700, style: "normal" },
      { file: "merriweather-400-italic.woff2", weight: 400, style: "italic" },
    ],
  },
};

export const ALL_FONT_FILES: FontFile[] = Object.values(FONT_DEFINITIONS).flatMap((d) => d.files);

function rule(family: string, src: string, weight: number, style: string): string {
  return (
    `@font-face{font-family:'${family}';src:${src};` +
    // `block` rather than `swap`: a fallback flash would change text metrics
    // mid-render, and the export waits on document.fonts.ready anyway.
    `font-weight:${weight};font-style:${style};font-display:block;}`
  );
}

/**
 * `@font-face` blocks for the browser, served from the web app's public dir.
 * Only the families the theme references are emitted.
 */
export function fontFacesForWeb(theme: Theme, basePath = "/fonts"): string {
  return uniqueDefinitions(theme)
    .flatMap((def) =>
      def.files.map((f) =>
        rule(def.family, `url('${basePath}/${f.file}') format('woff2')`, f.weight, f.style),
      ),
    )
    .join("\n");
}

/**
 * `@font-face` blocks with the bytes inlined, for the Puppeteer export.
 * `page.setContent()` has no origin, so a relative URL could never resolve.
 */
export function fontFacesFromBase64(
  theme: Theme,
  read: (file: string) => string | undefined,
): string {
  return uniqueDefinitions(theme)
    .flatMap((def) =>
      def.files.flatMap((f) => {
        const base64 = read(f.file);
        if (!base64) return [];
        return [rule(def.family, `url(data:font/woff2;base64,${base64}) format('woff2')`, f.weight, f.style)];
      }),
    )
    .join("\n");
}

/** The theme's body and heading families, de-duplicated when they're the same. */
function uniqueDefinitions(theme: Theme): FontDefinition[] {
  const keys = new Set<Theme["fontFamily"]>([theme.fontFamily, theme.headingFontFamily]);
  return [...keys].flatMap((key) => FONT_DEFINITIONS[key] ? [FONT_DEFINITIONS[key]!] : []);
}
