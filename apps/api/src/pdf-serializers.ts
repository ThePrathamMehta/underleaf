/**
 * Row → DTO for uploaded-PDF editing.
 *
 * The one job that needs explaining is turning storage keys into URLs. Keys are
 * internal (`users/<id>/pdfs/<id>/pages/0.png`) and must never reach the client —
 * they name a private bucket layout and embed another user's id space. So every
 * key becomes a path on *this* API, which then checks ownership before serving
 * the bytes. That indirection is what lets the store stay private with no
 * signed-URL plumbing.
 *
 * Paths are relative (no leading slash) so the web app can join them onto
 * whatever API base URL it was configured with, including one under a path
 * prefix. The server never has to know its own public URL.
 */
import path from "node:path";
import type { PdfDocument, PdfPage, PdfTextRun } from "@repo/db";
import {
  fontSourceSchema,
  type PdfDocumentDto,
  type PdfDocumentSummaryDto,
  type PdfEmbeddedFontDto,
  type PdfPageDto,
  type PdfTextRunDto,
} from "@repo/types";
import { FONT_MIME_TYPES, type FontExtension } from "./services/storage.js";

export type PdfDocumentWithPages = PdfDocument & {
  pages: Array<PdfPage & { runs: PdfTextRun[] }>;
};

export function serializePdfDocumentSummary(doc: PdfDocument): PdfDocumentSummaryDto {
  return {
    id: doc.id,
    title: doc.title,
    pageCount: doc.pageCount,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export function serializePdfDocument(doc: PdfDocumentWithPages): PdfDocumentDto {
  const pages = [...doc.pages].sort((a, b) => a.pageIndex - b.pageIndex);

  return {
    ...serializePdfDocumentSummary(doc),
    pages: pages.map((page) => serializePdfPage(doc.id, page)),
    fonts: collectEmbeddedFonts(doc.id, pages),
  };
}

function serializePdfPage(documentId: string, page: PdfPage & { runs: PdfTextRun[] }): PdfPageDto {
  return {
    id: page.id,
    pageIndex: page.pageIndex,
    width: page.width,
    height: page.height,
    // The version query param is the whole point of caching these hard: the path
    // is stable per page, so only a re-parse changes the URL.
    backgroundImageUrl:
      `pdfs/${documentId}/pages/${page.pageIndex}/image?v=${encodeURIComponent(page.backgroundVersion)}`,
    runs: page.runs.map(serializePdfTextRun),
  };
}

function serializePdfTextRun(run: PdfTextRun): PdfTextRunDto {
  return {
    id: run.id,
    x: run.x,
    y: run.y,
    width: run.width,
    height: run.height,
    baseline: run.baseline,
    fontFamily: run.fontFamily,
    // `fontSource` is a plain String column — Postgres enums would need a
    // migration per tier — so it's re-validated on the way out rather than cast.
    fontSource: fontSourceSchema.parse(run.fontSource),
    fontSize: run.fontSize,
    color: run.color,
    backgroundColor: run.backgroundColor,
    originalText: run.originalText,
    text: run.text,
  };
}

/**
 * The distinct embedded faces used by any run, as `@font-face` declarations.
 *
 * Family and format both come out of the storage key: the parser named the file
 * `<family>.<ttf|otf>` precisely so this needs no extra column and no read of
 * the font bytes.
 */
function collectEmbeddedFonts(
  documentId: string,
  pages: Array<PdfPage & { runs: PdfTextRun[] }>,
): PdfEmbeddedFontDto[] {
  const byFamily = new Map<string, PdfEmbeddedFontDto>();

  for (const page of pages) {
    for (const run of page.runs) {
      if (!run.embeddedFontUrl) continue;

      const file = path.posix.basename(run.embeddedFontUrl);
      const extension = path.posix.extname(file).slice(1) as FontExtension;
      const family = file.slice(0, file.length - (extension ? extension.length + 1 : 0));
      if (!family || byFamily.has(family)) continue;

      byFamily.set(family, {
        family,
        url: `pdfs/${documentId}/fonts/${encodeURIComponent(file)}`,
        mimeType: FONT_MIME_TYPES[extension] ?? FONT_MIME_TYPES.ttf,
      });
    }
  }

  return [...byFamily.values()];
}
