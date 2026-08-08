import { z } from "zod";

/**
 * Wire types for uploaded-PDF editing.
 *
 * Kept in their own module rather than folded into `api.ts` because this is a
 * different kind of document: a PDF-edit session is fixed-position text over a
 * raster backdrop, with no `content`/`theme` model behind it. Mixing the two
 * vocabularies in one file invites a future "one schema for both" refactor that
 * would fit neither.
 */

// --- Font resolution ---

/**
 * Which tier of the font-preservation strategy produced a run's font.
 *
 * - `embedded` — the PDF's own font program, re-embedded. Exact.
 * - `standard` — one of the base-14 PDF fonts, mapped to its web equivalent.
 *   Visually near-identical.
 * - `fallback` — matched by name against a small catalog, or a generic
 *   serif/sans. Approximate, and the only tier surfaced to the user as such.
 *
 * The order matters: it's a priority list, and `fallback` is the honest label we
 * refuse to hide.
 */
export const FONT_SOURCES = ["embedded", "standard", "fallback"] as const;

export const fontSourceSchema = z.enum(FONT_SOURCES);
export type FontSource = z.infer<typeof fontSourceSchema>;

/** `#rrggbb`, lowercase. The one colour format that crosses the wire. */
const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/, "Expected a #rrggbb colour");

// --- DTOs ---

export const pdfTextRunSchema = z.object({
  id: z.string(),
  /**
   * Bounding box in PDF points with a top-left origin, matching CSS. The server
   * converts from PDF's bottom-left origin once, at parse time, so neither the
   * editor nor the export path has to think about which convention it's in.
   */
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  /**
   * Distance from the top of the box down to the text baseline, in points.
   * Export needs this to invert the coordinate transform exactly — the parser
   * built the box from per-font ascent/descent, so `height` alone can't recover
   * where the baseline sits.
   */
  baseline: z.number(),
  /** A CSS font stack, ready to drop into `style.fontFamily`. */
  fontFamily: z.string(),
  fontSource: fontSourceSchema,
  fontSize: z.number(),
  color: hexColorSchema,
  /**
   * The colour behind this run, sampled from the rendered page. Used to hide the
   * original glyphs in the editor backdrop *and* to paint the redaction
   * rectangle at export — one value, so what you see is what exports.
   */
  backgroundColor: hexColorSchema,
  /** What the source PDF says. Never mutated; edits are a diff against it. */
  originalText: z.string(),
  /** What the user has typed. Equal to `originalText` until they edit. */
  text: z.string(),
});

export type PdfTextRunDto = z.infer<typeof pdfTextRunSchema>;

export const pdfPageSchema = z.object({
  id: z.string(),
  /** Zero-based. */
  pageIndex: z.number(),
  /** Page size in PDF points at scale 1 — the coordinate space `runs` live in. */
  width: z.number(),
  height: z.number(),
  /**
   * Path to the rendered page image on this API, already including the
   * cache-busting hash. Relative, so it works across origins without the server
   * needing to know its own public URL.
   */
  backgroundImageUrl: z.string(),
  runs: z.array(pdfTextRunSchema),
});

export type PdfPageDto = z.infer<typeof pdfPageSchema>;

/**
 * One `@font-face` the editor must declare before it can render the runs that
 * use it.
 *
 * Document-level rather than per-run because a font is shared: a 3-page resume
 * in one embedded family would otherwise repeat the same declaration on every
 * run, and the browser would have no way to know they're the same face.
 */
export const pdfEmbeddedFontSchema = z.object({
  /** The `font-family` name, unique per document — see the server's note on why. */
  family: z.string(),
  /** Relative path to the font program on this API. */
  url: z.string(),
  /** MIME type for the `format()` hint in the `@font-face` rule. */
  mimeType: z.string(),
});

export type PdfEmbeddedFontDto = z.infer<typeof pdfEmbeddedFontSchema>;

/** List-view shape: everything the dashboard needs, none of the page payload. */
export const pdfDocumentSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  pageCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type PdfDocumentSummaryDto = z.infer<typeof pdfDocumentSummarySchema>;

/** Editor-view shape: the whole document, in one request. */
export const pdfDocumentSchema = pdfDocumentSummarySchema.extend({
  pages: z.array(pdfPageSchema),
  /** Every embedded face used anywhere in the document, deduplicated. */
  fonts: z.array(pdfEmbeddedFontSchema),
});

export type PdfDocumentDto = z.infer<typeof pdfDocumentSchema>;

// --- Request bodies ---

/**
 * Autosave target, mirroring `PATCH /resumes/:id`. Only `text` is writable:
 * font, size, colour and position are inherited from the source PDF, and that
 * inheritance is the whole point of B.1's fixed-position model — a writable
 * font field would be a promise the editor can't keep.
 */
export const updatePdfTextRunBodySchema = z.object({
  /** Empty is legitimate — it's how a user deletes a line's text. */
  text: z.string().max(2000),
});

export type UpdatePdfTextRunBody = z.infer<typeof updatePdfTextRunBodySchema>;

export const renamePdfDocumentBodySchema = z.object({
  title: z.string().min(1).max(160),
});

export type RenamePdfDocumentBody = z.infer<typeof renamePdfDocumentBodySchema>;
