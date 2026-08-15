import { z } from "zod";

/**
 * The first six families are bundled for offline rendering. The schema also
 * accepts safe catalog slugs so the editor can load the broader Google Fonts
 * selection in both the browser and the PDF renderer.
 */
export const FONT_FAMILIES = [
  "inter",
  "lato",
  "roboto",
  "source-serif",
  "eb-garamond",
  "merriweather",
] as const;

/** Searchable resume catalog, shared by document and selected-text controls. */
export const FONT_CATALOG = [
  "inter", "roboto", "open-sans", "lato", "montserrat", "poppins", "raleway", "nunito", "ubuntu", "work-sans",
  "source-sans-3", "noto-sans", "rubik", "mulish", "manrope", "dm-sans", "quicksand", "karla", "barlow", "archivo",
  "merriweather", "source-serif", "eb-garamond", "playfair-display", "lora", "libre-baskerville", "crimson-text", "bitter",
  "noto-serif", "pt-serif", "roboto-slab", "zilla-slab", "cormorant-garamond", "spectral", "vollkorn", "cardo", "arvo",
  "oswald", "bebas-neue", "anton", "abril-fatface", "lobster", "pacifico", "caveat", "dancing-script", "comfortaa",
  "fira-sans", "fira-code", "source-code-pro", "roboto-mono", "space-mono", "inconsolata", "jetbrains-mono",
] as const;

export const fontFamilySchema = z.string().min(1).max(80).regex(/^[a-z0-9-]+$/);
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
