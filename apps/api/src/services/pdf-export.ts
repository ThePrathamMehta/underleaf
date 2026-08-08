/**
 * Exports an edited uploaded PDF using the redact-and-redraw strategy (spec B.2.6).
 *
 * This is structurally different from the Puppeteer-based resume export in
 * `pdf.tsx`: that one renders our own HTML/CSS as a new PDF from scratch; this
 * one modifies the *original* PDF bytes, so every non-text element and every
 * unedited run survives exactly as the source had it.
 *
 * Each edited run is handled in two steps. **Redact**: paint a filled rectangle
 * in the run's sampled background colour over its original glyphs. **Redraw**:
 * draw the new text on top at the same position, size and colour. The parser
 * already replays the identical erase onto the editor's backdrop image, so the
 * two views can't disagree about what an edit looks like.
 */
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { PdfTextRun } from "@repo/db";
import type { PdfDocumentWithPages } from "../pdf-serializers.js";
import { storage } from "./storage.js";
import { standardFontFor, type FontClass } from "./pdf-fonts.js";

/**
 * Fonts embedded into the output, keyed so each program is embedded once per
 * export. Without this every run would re-embed its font, and a 3-page resume
 * would carry dozens of copies of the same face.
 */
type FontCache = {
  /** By storage key, for the `embedded` tier. */
  embedded: Map<string, PDFFont>;
  /** By base-14 name, for the `standard` and `fallback` tiers. */
  standard: Map<string, PDFFont>;
};

/**
 * Rebuilds the PDF with the user's edits applied. Returns bytes ready to stream
 * as `application/pdf`.
 */
export async function exportEditedPdf(doc: PdfDocumentWithPages): Promise<Uint8Array> {
  const source = await storage.get(doc.originalFileUrl);
  if (!source) {
    throw new Error(`Original PDF is missing from storage for document ${doc.id}`);
  }

  const pdfDoc = await PDFDocument.load(source.bytes, { ignoreEncryption: true });
  // Required before `embedFont` will accept an arbitrary font program; pdf-lib
  // only handles the base-14 without it.
  pdfDoc.registerFontkit(fontkit);

  const fonts: FontCache = { embedded: new Map(), standard: new Map() };
  const pages = [...doc.pages].sort((a, b) => a.pageIndex - b.pageIndex);

  for (const pageData of pages) {
    // A page index past the end means the stored parse disagrees with the stored
    // source. Skipping keeps the rest of the export usable.
    if (pageData.pageIndex >= pdfDoc.getPageCount()) continue;
    const page = pdfDoc.getPage(pageData.pageIndex);

    for (const run of pageData.runs) {
      // Unedited runs keep the source's own glyphs — redrawing them would only
      // add rounding error and lose any kerning the producer applied.
      if (run.text === run.originalText) continue;

      await redactAndRedrawRun(pdfDoc, page, run, fonts);
    }
  }

  return await pdfDoc.save();
}

async function redactAndRedrawRun(
  pdfDoc: PDFDocument,
  page: PDFPage,
  run: PdfTextRun,
  fonts: FontCache,
): Promise<void> {
  const { height: pageHeight } = page.getSize();

  // Resolve the font and confirm it can encode the text *before* painting
  // anything. If either fails, the run is left exactly as the source had it —
  // redacting first would erase the original glyphs with nothing to replace them.
  const drawable = await resolveDrawable(pdfDoc, run, fonts);
  if (!drawable) return;

  // Runs are stored top-left origin (CSS); PDF user space is bottom-left.
  const boxBottom = pageHeight - run.y - run.height;

  const bg = parseHexColor(run.backgroundColor);
  page.drawRectangle({
    x: run.x - 1,
    y: boxBottom - 1,
    width: run.width + 2,
    height: run.height + 2,
    // A pixel of bleed on each edge catches the antialiasing fringe, which would
    // otherwise survive as a grey halo around the erased text. Matches the bleed
    // the parser uses when erasing the same run from the backdrop image.
    color: rgb(bg.r, bg.g, bg.b),
    borderWidth: 0,
  });

  // `baseline` is the parser's own ascent × fontSize, so this lands the new text
  // on exactly the baseline the original sat on — and therefore in line with the
  // unedited runs beside it.
  const color = parseHexColor(run.color);
  page.drawText(drawable.text, {
    x: run.x,
    y: pageHeight - run.y - run.baseline,
    size: run.fontSize,
    font: drawable.font,
    color: rgb(color.r, color.g, color.b),
  });
}

/**
 * The font and the exact string to draw, or null when this run can't be redrawn
 * safely and should keep its original glyphs.
 */
interface Drawable {
  font: PDFFont;
  text: string;
}

async function resolveDrawable(
  pdfDoc: PDFDocument,
  run: PdfTextRun,
  fonts: FontCache,
): Promise<Drawable | null> {
  const font = await resolveExportFont(pdfDoc, run, fonts);
  if (!font) return null;

  // pdf-lib throws on a character the font can't encode — the base-14 fonts only
  // cover WinAnsi, so one pasted “ ” or “—” would otherwise fail the whole
  // export. Sanitizing to the nearest ASCII keeps the edit, and dropping the run
  // is the last resort.
  if (canEncode(font, run.text)) return { font, text: run.text };

  const sanitized = sanitizeForWinAnsi(run.text);
  if (canEncode(font, sanitized)) {
    console.warn(
      `[pdf-export] run ${run.id}: substituted unsupported characters for the export`,
    );
    return { font, text: sanitized };
  }

  console.warn(`[pdf-export] run ${run.id}: text is unencodable, leaving the original`);
  return null;
}

/**
 * Picks the font for export in the same priority order the parser used, so the
 * exported page matches what the editor showed.
 */
async function resolveExportFont(
  pdfDoc: PDFDocument,
  run: PdfTextRun,
  fonts: FontCache,
): Promise<PDFFont | null> {
  // Tier 1 — the PDF's own font program. The parser only takes this tier for
  // formats a browser can also render, so editor and export agree.
  if (run.embeddedFontUrl) {
    const cached = fonts.embedded.get(run.embeddedFontUrl);
    if (cached) return cached;

    const program = await storage.get(run.embeddedFontUrl);
    if (program) {
      try {
        // Subset fonts carry only the glyphs the source used, so a newly typed
        // character may be missing. `subset: false` keeps every glyph the program
        // does have; anything genuinely absent falls to the encode check above.
        const font = await pdfDoc.embedFont(program.bytes, { subset: false });
        fonts.embedded.set(run.embeddedFontUrl, font);
        return font;
      } catch (error) {
        // A malformed or unsupported program shouldn't fail the export — the
        // run's `fontFamily` still names a CSS stack we can map to a base-14
        // face, which is the same thing the editor falls back to.
        console.warn(`[pdf-export] could not embed ${run.embeddedFontUrl}:`, error);
      }
    }
  }

  // Tiers 2 and 3 — both resolve to a base-14 font. `fontFamily` is a CSS stack
  // the parser built from one of three fixed templates, so its generic family
  // tells us which class to draw with.
  const name = standardFontFor(
    classifyFontFamily(run.fontFamily),
    looksBold(run.fontFamily),
    looksItalic(run.fontFamily),
  );

  const cached = fonts.standard.get(name);
  if (cached) return cached;

  const font = await pdfDoc.embedFont(name);
  fonts.standard.set(name, font);
  return font;
}

/**
 * Maps a CSS stack back to the class that produced it.
 *
 * Matches on the generic family that terminates every stack `pdf-fonts.ts`
 * builds (`sans-serif`, `serif`, `monospace`) rather than on a concrete name:
 * embedded runs prepend a document-specific family, and that name could contain
 * any substring at all.
 */
function classifyFontFamily(stack: string): FontClass {
  const lower = stack.toLowerCase();
  if (lower.endsWith("monospace")) return "mono";
  // Checked after monospace and against the terminator only, so the "serif"
  // inside "sans-serif" can't win.
  if (lower.endsWith("sans-serif")) return "sans";
  if (lower.endsWith("serif")) return "serif";
  return "sans";
}

// The parser doesn't record weight and style as columns — they're baked into the
// embedded family name it generates, which is the only part of a stack that can
// carry them.
function looksBold(stack: string): boolean {
  return /bold|black|heavy|semibold|demibold/i.test(stack);
}

function looksItalic(stack: string): boolean {
  return /italic|oblique/i.test(stack);
}

/** Whether `font` can encode every character in `text`. */
function canEncode(font: PDFFont, text: string): boolean {
  try {
    font.encodeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Replaces the typographic characters a user is most likely to paste in with
 * their WinAnsi-representable equivalents, then drops anything still outside the
 * range. Losing a curly quote's curl is a far better outcome than losing the
 * edit.
 */
function sanitizeForWinAnsi(text: string): string {
  return text
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—―]/g, "-")
    .replace(/…/g, "...")
    .replace(/[•·]/g, "-")
    // Non-breaking space as an escape, not the literal character: the two are
    // indistinguishable on screen, and WinAnsi has no glyph for U+00A0.
    .replace(/\u00a0/g, " ")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
}

/** `#rrggbb` to pdf-lib's 0–1 channels. The colour schema guarantees the format. */
function parseHexColor(hex: string): { r: number; g: number; b: number } {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16) / 255,
    g: Number.parseInt(hex.slice(3, 5), 16) / 255,
    b: Number.parseInt(hex.slice(5, 7), 16) / 255,
  };
}
