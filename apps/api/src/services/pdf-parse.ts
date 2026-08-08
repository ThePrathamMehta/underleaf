/**
 * Turns an uploaded PDF into the editor's data model: one rasterized backdrop
 * per page, plus a set of fixed-position text runs laid over it.
 *
 * Two things make this work:
 *
 * 1. **The backdrop carries everything we can't edit** — rules, logos, images,
 *    rotated or otherwise unhandled text. Whatever we don't lift into a run stays
 *    baked into the image, so the page always looks complete.
 * 2. **Every run we do lift is erased from the backdrop**, painted over with the
 *    background colour sampled from that exact spot. Without this the user would
 *    see the original glyphs *and* the editable overlay on top of them. That same
 *    erase is what the export replays onto the real PDF, so the editor and the
 *    exported file are showing the same operation.
 */
import { createCanvas, DOMMatrix, Path2D, ImageData } from "@napi-rs/canvas";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import type { FontSource } from "@repo/types";
import {
  embeddedCssStack,
  embeddedFamilyName,
  extractEmbeddedFonts,
  resolveFont,
  type EmbeddedFontProgram,
} from "./pdf-fonts";

// pdfjs 6 expects browser globals Bun doesn't provide. @napi-rs/canvas ships
// real implementations, so install them before pdfjs is ever imported.
const globals = globalThis as Record<string, unknown>;
globals.DOMMatrix ??= DOMMatrix;
globals.Path2D ??= Path2D;
globals.ImageData ??= ImageData;

// pdfjs reads the base-14 font files through `process.getBuiltinModule("fs")`,
// which this Bun version doesn't implement — without it every standard font
// silently fails to load and pages rasterize with substituted glyphs. Guarded by
// `??=`, so it does nothing once Bun ships its own.
const nodeRequire = createRequire(import.meta.url);
const proc = process as unknown as { getBuiltinModule?: (id: string) => unknown };
proc.getBuiltinModule ??= (id: string) => nodeRequire(id.startsWith("node:") ? id : `node:${id}`);

/** Loaded lazily so the polyfills above are in place first. */
let pdfjsPromise: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | null = null;
function getPdfjs() {
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsPromise;
}

/**
 * pdfjs needs the base-14 font programs on disk to rasterize a PDF that only
 * *references* Helvetica/Times/Courier. Without it those pages render with
 * substituted metrics and the backdrop stops matching the run positions.
 *
 * Deliberately a plain path with forward slashes rather than a `file://` URL:
 * pdfjs validates that this ends in `/` (so Windows separators fail the check)
 * but then hands it straight to `fs.readFile`, which does not accept a `file://`
 * *string*. Forward slashes satisfy both, on every platform.
 */
const STANDARD_FONT_DATA_URL =
  path
    .join(
      path.dirname(fileURLToPath(import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs"))),
      "..",
      "..",
      "standard_fonts",
    )
    .replaceAll("\\", "/") + "/";

/** 2× gives crisp small text at 100% zoom without quadrupling the file size. */
const RASTER_SCALE = 2;

/**
 * Postgres text columns reject NUL bytes; pdfjs yields them for unmapped glyphs.
 *
 * Matching a control character is the entire point here, so the rule that
 * forbids it is disabled rather than worked around — a character class built to
 * avoid the literal would say the same thing less clearly.
 */
// eslint-disable-next-line no-control-regex
const NUL_BYTES = /\x00/g;

// --- Types ---

export interface ParsedRun {
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Distance from the top of the box down to the baseline, in points. Kept
   * because export can't recover it: the box is built from the font's ascent and
   * descent, and `height` is one equation in both.
   */
  baseline: number;
  fontFamily: string;
  fontSource: FontSource;
  fontSize: number;
  color: string;
  backgroundColor: string;
  originalText: string;
  /** Set when `fontSource` is `embedded`; keys into `ParseResult.fontPrograms`. */
  fontProgramId: string | null;
}

export interface ParsedPage {
  pageIndex: number;
  /** PDF points at scale 1 — the space every run coordinate is in. */
  width: number;
  height: number;
  /** PNG bytes of the backdrop, with editable runs already erased. */
  image: Buffer;
  runs: ParsedRun[];
}

export interface ParsedFontProgram {
  /** CSS family name, unique to this document. */
  family: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface ParseResult {
  pageCount: number;
  pages: ParsedPage[];
  /** Embedded font programs actually used by at least one run, by id. */
  fontPrograms: Map<string, ParsedFontProgram>;
}

/**
 * Thrown when a PDF has no extractable text layer — a scan or an
 * image-only export. Callers turn this into a clear 400 rather than letting the
 * user land in an editor with nothing to edit (spec B.7).
 */
export class NoTextLayerError extends Error {
  constructor() {
    super(
      "This PDF has no selectable text — it looks like a scan or an image-only export. " +
        "Editing scanned PDFs needs OCR, which Underleaf doesn't do yet.",
    );
    this.name = "NoTextLayerError";
  }
}

export class UnreadablePdfError extends Error {
  constructor(cause?: unknown) {
    super("That file couldn't be read as a PDF. It may be corrupt or password-protected.");
    this.name = "UnreadablePdfError";
    this.cause = cause;
  }
}

// --- Colour helpers ---

/**
 * Clamps to a valid `#rrggbb` string. The non-finite guard matters: these values
 * come from sampled pixels, and one NaN would otherwise produce "#NaNNaNNaN",
 * which the DTO's colour schema rejects — losing the whole document over one bad
 * pixel read.
 */
function toHex(r: number, g: number, b: number): string {
  const channel = (v: number) =>
    (Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v))) : 0).toString(16).padStart(2, "0");
  return "#" + channel(r) + channel(g) + channel(b);
}

/** Squared RGB distance. Squared because we only ever compare, never report it. */
function distance(a: readonly number[], b: readonly number[]): number {
  return (a[0]! - b[0]!) ** 2 + (a[1]! - b[1]!) ** 2 + (a[2]! - b[2]!) ** 2;
}

// --- Text item geometry ---

interface RawItem {
  str: string;
  transform: number[];
  width: number;
  fontName: string;
}

interface Placed {
  text: string;
  left: number;
  /** Distance from the top of the page to the text baseline. */
  baselineTop: number;
  width: number;
  fontSize: number;
  fontName: string;
  ascent: number;
  descent: number;
}

/**
 * pdfjs reports one item per text-showing operator, which for many producers is
 * one per word or even per kerned fragment. Editing those separately would be
 * miserable, so contiguous items sharing a font, size and baseline are merged
 * back into the line they visually form.
 *
 * The gap threshold is what stops this from gluing two columns into one run: a
 * quarter of the font size is wider than any inter-word space and far narrower
 * than any real column gutter.
 */
function mergeIntoLines(items: Placed[]): Placed[] {
  const lines: Placed[] = [];

  for (const item of items) {
    const prev = lines[lines.length - 1];
    const gap = prev ? item.left - (prev.left + prev.width) : Infinity;

    const continues =
      prev &&
      prev.fontName === item.fontName &&
      Math.abs(prev.fontSize - item.fontSize) < 0.1 &&
      Math.abs(prev.baselineTop - item.baselineTop) < 0.5 &&
      gap < item.fontSize * 0.25 &&
      gap > -item.fontSize * 0.5;

    if (!continues) {
      lines.push({ ...item });
      continue;
    }

    // A visible gap that neither side already spells as a space is one; without
    // this, producers that position words instead of emitting spaces would give
    // us runs with every word jammed together.
    const needsSpace =
      gap > item.fontSize * 0.08 && !/\s$/.test(prev!.text) && !/^\s/.test(item.text);

    prev!.text += (needsSpace ? " " : "") + item.text;
    prev!.width = item.left + item.width - prev!.left;
  }

  return lines;
}

// --- Parse ---

export async function parsePdf(source: Uint8Array, documentId: string): Promise<ParseResult> {
  const pdfjs = await getPdfjs();

  // pdfjs transfers ownership of the buffer it's given, so both readers get
  // their own copy — pdf-lib would otherwise see a detached array.
  let libDoc: PDFDocument;
  try {
    libDoc = await PDFDocument.load(new Uint8Array(source), { ignoreEncryption: true });
  } catch (error) {
    throw new UnreadablePdfError(error);
  }

  const embeddedFonts = extractEmbeddedFonts(libDoc);

  let doc: Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
  let loadingTask: ReturnType<typeof pdfjs.getDocument>;
  try {
    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(source),
      standardFontDataUrl: STANDARD_FONT_DATA_URL,
      // System font lookup is a no-op on a server and adds startup cost.
      useSystemFonts: false,
      // Honoured at runtime but missing from pdfjs 6's published types, hence the
      // cast. Worth keeping: it stops pdfjs building glyph accessors with `Function`
      // on input we don't control.
      isEvalSupported: false,
    } as Parameters<typeof pdfjs.getDocument>[0]);
    doc = await loadingTask.promise;
  } catch (error) {
    throw new UnreadablePdfError(error);
  }

  const pages: ParsedPage[] = [];
  const fontPrograms = new Map<string, ParsedFontProgram>();
  let totalCharacters = 0;
  const pageCount = doc.numPages;

  for (let index = 0; index < pageCount; index++) {
    const page = await doc.getPage(index + 1);
    const viewport = page.getViewport({ scale: 1 });

    // getOperatorList() is what populates commonObjs; without it the font
    // objects behind pdfjs's internal ids aren't there yet.
    await page.getOperatorList();
    const textContent = await page.getTextContent();
    const styles = textContent.styles as Record<
      string,
      { ascent?: number | null; descent?: number | null; fontFamily?: string }
    >;

    // --- 1. Place every usable text item ---

    const placed: Placed[] = [];
    for (const raw of textContent.items as unknown as RawItem[]) {
      if (typeof raw.str !== "string" || raw.str.length === 0) continue;
      const [a, b, c, d, e, f] = raw.transform;
      if (
        a === undefined || b === undefined || c === undefined ||
        d === undefined || e === undefined || f === undefined
      ) continue;

      // Rotated or skewed text would need a transform on the overlay and a
      // matching one at export. Out of scope for v3 — leaving it in the backdrop
      // renders it correctly, it just isn't editable.
      if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01) continue;

      const fontSize = Math.abs(d);
      if (fontSize < 0.5) continue;

      // A non-finite position or width can't be laid out, and one that slips
      // through poisons the erase rect and the colour sample too. Skipping the
      // item leaves its glyphs in the backdrop, which still renders correctly.
      if (!Number.isFinite(e) || !Number.isFinite(f) || !Number.isFinite(raw.width)) continue;

      const style = styles[raw.fontName] ?? {};
      // Type3 and some base-14 fonts report metrics as NaN rather than omitting
      // them, so this has to be a finiteness check — `typeof NaN === "number"`.
      // An unguarded NaN propagates all the way to a null y and a "#NaNNaNNaN"
      // colour. The defaults are the usual ratios and only affect the box, not
      // the glyphs. Signs are normalized because producers disagree on whether
      // descent is negative.
      const ascent = usableMetric(style.ascent, 0.75);
      const descent = -usableMetric(style.descent, 0.25);

      placed.push({
        text: raw.str,
        left: e,
        baselineTop: viewport.height - f,
        width: raw.width,
        fontSize,
        fontName: raw.fontName,
        ascent,
        descent,
      });
    }

    // Merging assumes reading order; producers don't always emit it.
    placed.sort((p, q) => p.baselineTop - q.baselineTop || p.left - q.left);
    const lines = mergeIntoLines(placed).filter((line) => line.text.trim().length > 0);
    totalCharacters += lines.reduce((sum, line) => sum + line.text.trim().length, 0);

    // --- 2. Rasterize ---

    const rasterViewport = page.getViewport({ scale: RASTER_SCALE });
    const canvas = createCanvas(Math.ceil(rasterViewport.width), Math.ceil(rasterViewport.height));
    const ctx = canvas.getContext("2d");
    await page.render({
      canvasContext: ctx as never,
      viewport: rasterViewport,
      canvas: canvas as never,
    }).promise;

    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const pixelAt = (x: number, y: number): readonly [number, number, number] => {
      const cx = Math.max(0, Math.min(canvas.width - 1, Math.round(x)));
      const cy = Math.max(0, Math.min(canvas.height - 1, Math.round(y)));
      const i = (cy * canvas.width + cx) * 4;
      return [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
    };

    // --- 3. Build runs, sampling colour before anything is painted over ---

    const runs: ParsedRun[] = [];
    for (const line of lines) {
      const top = line.baselineTop - line.ascent * line.fontSize;
      const height = (line.ascent - line.descent) * line.fontSize;
      const box = { left: line.left, top, width: line.width, height };

      const { color, backgroundColor } = sampleColors(box, pixelAt);

      // --- font ---
      const fontObject = page.commonObjs.has(line.fontName)
        ? (page.commonObjs.get(line.fontName) as {
            name?: string;
            bold?: boolean;
            italic?: boolean;
            fallbackName?: string;
          })
        : null;
      const rawName = fontObject?.name ?? styles[line.fontName]?.fontFamily ?? "";
      const fallbackName = fontObject?.fallbackName ?? styles[line.fontName]?.fontFamily ?? "";

      const resolved = resolveFont(rawName, embeddedFonts, {
        bold: fontObject?.bold,
        italic: fontObject?.italic,
        serif: fallbackName.includes("serif") && !fallbackName.includes("sans"),
        mono: fallbackName.includes("mono"),
      });

      let fontFamily = resolved.fontFamily;
      let fontProgramId: string | null = null;
      if (resolved.fontSource === "embedded" && resolved.program) {
        fontProgramId = registerProgram(fontPrograms, documentId, resolved.program);
        fontFamily = embeddedCssStack(fontPrograms.get(fontProgramId)!.family, resolved.fontClass);
      }

      runs.push({
        x: round(box.left),
        y: round(box.top),
        width: round(box.width),
        height: round(box.height),
        baseline: round(line.ascent * line.fontSize),
        fontFamily,
        fontSource: resolved.fontSource,
        fontSize: round(line.fontSize),
        color,
        backgroundColor,
        // Postgres text columns reject NUL bytes. pdfjs yields U+0000 for glyphs
        // without a ToUnicode mapping; strip them so the run persists.
        originalText: line.text.replace(NUL_BYTES, ""),
        fontProgramId,
      });
    }

    // --- 4. Erase the runs we lifted, so the overlay isn't drawn over a ghost ---

    for (const run of runs) {
      ctx.fillStyle = run.backgroundColor;
      // A pixel of bleed on each side catches the antialiasing fringe, which
      // would otherwise survive as a grey halo around the erased text.
      ctx.fillRect(
        run.x * RASTER_SCALE - 1,
        run.y * RASTER_SCALE - 1,
        run.width * RASTER_SCALE + 2,
        run.height * RASTER_SCALE + 2,
      );
    }

    pages.push({
      pageIndex: index,
      width: viewport.width,
      height: viewport.height,
      image: canvas.toBuffer("image/png"),
      runs,
    });

    page.cleanup();
  }

  // Releases the worker and its page caches. Done before the scanned-PDF check
  // below so the most common rejection path doesn't leak one.
  await loadingTask.destroy();

  // A handful of stray characters is still a scan — page numbers and headers get
  // extracted from otherwise image-only documents all the time.
  if (totalCharacters < 20) throw new NoTextLayerError();

  return { pageCount, pages, fontPrograms };
}

// --- Helpers ---

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * A font metric as a positive magnitude, or `fallback` when pdfjs didn't give us
 * a usable one. Zero counts as unusable — it collapses the run's box to nothing.
 */
function usableMetric(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value !== 0
    ? Math.abs(value)
    : fallback;
}

/**
 * Recovers a run's glyph colour and the colour immediately behind it.
 *
 * Background comes first, as the most common colour in a two-pixel ring just
 * outside the box. The glyph colour is then the pixel *furthest* from that
 * background — which works for light-on-dark as well as dark-on-light, where
 * simply taking the darkest pixel would return the background itself.
 */
function sampleColors(
  box: { left: number; top: number; width: number; height: number },
  pixelAt: (x: number, y: number) => readonly [number, number, number],
): { color: string; backgroundColor: string } {
  const s = RASTER_SCALE;
  const x0 = box.left * s;
  const y0 = box.top * s;
  const x1 = (box.left + box.width) * s;
  const y1 = (box.top + box.height) * s;

  const ring = new Map<string, { count: number; rgb: readonly [number, number, number] }>();
  const note = (px: readonly [number, number, number]) => {
    const key = px.join(",");
    const entry = ring.get(key);
    if (entry) entry.count += 1;
    else ring.set(key, { count: 1, rgb: px });
  };

  const step = Math.max(1, Math.round((x1 - x0) / 60));
  for (let x = x0 - 2; x <= x1 + 2; x += step) {
    note(pixelAt(x, y0 - 2));
    note(pixelAt(x, y1 + 2));
  }
  for (let y = y0; y <= y1; y += Math.max(1, Math.round((y1 - y0) / 12))) {
    note(pixelAt(x0 - 2, y));
    note(pixelAt(x1 + 2, y));
  }

  let background: readonly [number, number, number] = [255, 255, 255];
  let best = 0;
  for (const { count, rgb } of ring.values()) {
    if (count > best) {
      best = count;
      background = rgb;
    }
  }

  let glyph = background;
  let furthest = 0;
  const sx = Math.max(1, Math.round((x1 - x0) / 200));
  const sy = Math.max(1, Math.round((y1 - y0) / 40));
  for (let y = y0; y <= y1; y += sy) {
    for (let x = x0; x <= x1; x += sx) {
      const px = pixelAt(x, y);
      const d = distance(px, background);
      if (d > furthest) {
        furthest = d;
        glyph = px;
      }
    }
  }

  // Nothing in the box differed from its surroundings — the run is invisible or
  // clipped. Black is the safe assumption; guessing the background would make
  // the text disappear in the editor too.
  if (furthest < 400) glyph = [0, 0, 0];

  return {
    color: toHex(glyph[0], glyph[1], glyph[2]),
    backgroundColor: toHex(background[0], background[1], background[2]),
  };
}

/** Registers an embedded program once per document, returning its stable id. */
function registerProgram(
  programs: Map<string, ParsedFontProgram>,
  documentId: string,
  program: EmbeddedFontProgram,
): string {
  const family = embeddedFamilyName(documentId, program.baseName);
  if (!programs.has(family)) {
    programs.set(family, {
      family,
      mimeType: program.webMimeType ?? "font/ttf",
      bytes: program.bytes,
    });
  }
  return family;
}
