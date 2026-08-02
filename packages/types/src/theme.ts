import { z } from "zod";

/**
 * Font families are a closed enum of families vendored as WOFF2 in
 * `packages/ui/src/resume/fonts`. Never a free string: the editor and the
 * Puppeteer export must resolve identical font bytes, so a family the renderer
 * doesn't ship has to be unrepresentable.
 */
export const FONT_FAMILIES = [
  "inter",
  "lato",
  "roboto",
  "source-serif",
  "eb-garamond",
  "merriweather",
] as const;

export const fontFamilySchema = z.enum(FONT_FAMILIES);
export type FontFamily = z.infer<typeof fontFamilySchema>;

export const LAYOUTS = [
  "single-column",
  "sidebar-left",
  "sidebar-right",
  "two-column",
] as const;

export const layoutSchema = z.enum(LAYOUTS);
export type Layout = z.infer<typeof layoutSchema>;

export const PAGE_SIZES = ["a4", "letter"] as const;

export const pageSizeSchema = z.enum(PAGE_SIZES);
export type PageSize = z.infer<typeof pageSizeSchema>;

/** Hex color, 3 or 6 digits. Kept strict so it can be dropped into CSS safely. */
export const hexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Must be a hex color");

export const themeSchema = z.object({
  fontFamily: fontFamilySchema,
  headingFontFamily: fontFamilySchema,
  /** Multiplier applied to every base type size. 1 = template default. */
  fontSizeScale: z.number().min(0.8).max(1.3),
  accentColor: hexColorSchema,
  textColor: hexColorSchema,
  lineSpacing: z.number().min(1).max(2),
  /** Page padding in millimetres, the single source of the printed margin. */
  marginSize: z.number().min(8).max(30),
  layout: layoutSchema,
  pageSize: pageSizeSchema,
});

export type Theme = z.infer<typeof themeSchema>;

export const DEFAULT_THEME: Theme = {
  fontFamily: "inter",
  headingFontFamily: "inter",
  fontSizeScale: 1,
  accentColor: "#1a1a1a",
  textColor: "#1a1a1a",
  lineSpacing: 1.25,
  marginSize: 14,
  layout: "single-column",
  pageSize: "letter",
};
