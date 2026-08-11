/**
 * Routes for uploaded-PDF editing (spec B).
 *
 * POST /pdfs          — multipart upload, parse, persist
 * GET /pdfs           — list the caller's documents
 * GET /pdfs/:id       — one document with all pages and runs
 * PATCH /pdfs/:id     — rename only (no re-parse trigger yet)
 * DELETE /pdfs/:id    — cascade delete document, pages, runs, and blobs
 * PATCH /pdfs/:id/runs/:runId — autosave one text run
 * GET /pdfs/:id/pages/:pageIndex/image — serve backdrop PNG
 * GET /pdfs/:id/fonts/:file — serve embedded font program
 * GET /pdfs/:id/export.pdf — redact-and-redraw export
 *
 * Every route is owner-scoped: the userId filter is in the query itself, not a
 * post-fetch check. Blob-serving routes confirm ownership before returning bytes.
 */
import { Router } from "express";
import multer from "multer";
import { prisma } from "@repo/db";
import {
  renamePdfDocumentBodySchema,
  updatePdfTextRunBodySchema,
} from "@repo/types";
import { asyncHandler, badRequest, notFound, validateBody, HttpError } from "../middleware/errors.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import {
  serializePdfDocument,
  serializePdfDocumentSummary,
  type PdfDocumentWithPages,
} from "../pdf-serializers.js";
import { config } from "../config.js";
import { storage, storageKeys } from "../services/storage.js";
import { parsePdfIsolated } from "../services/pdf-parse-job.js";
import { exportEditedPdf } from "../services/pdf-export.js";

export const pdfsRouter = Router();

// Every route below is owner-scoped. This is an authorization surface, so the
// userId filter belongs in the query itself — never a post-fetch check.
pdfsRouter.use(requireAuth);

/**
 * Loads a PDF document only if it belongs to the caller; 404s rather than 403s
 * so the endpoint doesn't confirm that someone else's id exists.
 */
async function findOwnedDocument(id: string, userId: string): Promise<PdfDocumentWithPages> {
  const doc = await prisma.pdfDocument.findFirst({
    where: { id, userId },
    include: { pages: { include: { runs: true } } },
  });
  if (!doc) throw notFound("PDF document");
  return doc;
}

/**
 * How many text runs to insert per statement. Postgres binds one parameter per
 * column per row and refuses a statement carrying more than 65535 of them; a run
 * writes sixteen columns, so 2000 rows is 32k — comfortably clear, and few
 * enough statements that even a document at the page cap lands in a handful.
 */
const RUN_INSERT_CHUNK = 2000;

/** In-memory buffer for the upload (spec caps it at 15MB). */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      // MulterError is what errorHandler expects for uploads; a plain Error would
      // match the generic string-based branch, which is fragile.
      cb(new HttpError(415, "Only PDF files are accepted"));
    }
  },
});

pdfsRouter.get(
  "/",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const docs = await prisma.pdfDocument.findMany({
      where: { userId: req.userId },
      orderBy: { updatedAt: "desc" },
    });
    res.json({ documents: docs.map(serializePdfDocumentSummary) });
  }),
);

pdfsRouter.post(
  "/",
  upload.single("file"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    if (!req.file) throw badRequest("Missing PDF file");

    const doc = await prisma.pdfDocument.create({
      data: {
        userId: req.userId,
        // Placeholder values; parse will overwrite these in the same transaction.
        originalFileUrl: "",
        pageCount: 0,
        title: req.file.originalname || "Untitled PDF",
      },
    });

    const sourceKey = storageKeys.source(req.userId, doc.id);
    await storage.put(sourceKey, req.file.buffer, "application/pdf");

    // Parse runs isolated and retries crashes; a reported failure is a verdict.
    const result = await parsePdfIsolated({
      userId: req.userId,
      documentId: doc.id,
      sourceKey,
    });

    if (!result.ok) {
      await storage.deletePrefix(storageKeys.document(req.userId, doc.id));
      await prisma.pdfDocument.delete({ where: { id: doc.id } });
      throw badRequest(result.message);
    }

    // Transactionally persist the parse result. The document row and its children
    // are one unit: if this fails partway through, the cleanup above already ran
    // and the blobs are gone, so Prisma's cascade handles the orphaned row.
    //
    // Three bulk statements rather than a create per page plus a createMany per
    // page's runs. That loop issued 2N+1 *sequential* round trips inside an
    // interactive transaction, which overran Prisma's 5s default on any document
    // with more than a handful of pages: by the time a later create was sent the
    // transaction had already been closed, surfacing as P2028. Page count, not
    // file size, was what decided whether an upload survived.
    await prisma.$transaction(
      async (tx) => {
        await tx.pdfDocument.update({
          where: { id: doc.id },
          data: { originalFileUrl: sourceKey, pageCount: result.pageCount },
        });

        await tx.pdfPage.createMany({
          data: result.pages.map((parsedPage) => ({
            pdfDocumentId: doc.id,
            pageIndex: parsedPage.pageIndex,
            width: parsedPage.width,
            height: parsedPage.height,
            backgroundImageUrl: parsedPage.backgroundKey,
            backgroundVersion: parsedPage.backgroundVersion,
          })),
        });

        // createMany doesn't hand back generated ids, and the runs need one as a
        // foreign key. Reading them back by pageIndex — unique per document — is
        // a single round trip and keeps the schema's own cuid default rather
        // than minting ids here in a second id format.
        const pageIdByIndex = new Map(
          (
            await tx.pdfPage.findMany({
              where: { pdfDocumentId: doc.id },
              select: { id: true, pageIndex: true },
            })
          ).map((page) => [page.pageIndex, page.id]),
        );

        const runRows = result.pages.flatMap((parsedPage) => {
          const pdfPageId = pageIdByIndex.get(parsedPage.pageIndex);
          // We created this page two statements ago, so a miss is a broken
          // invariant rather than a data problem. Throwing rolls the whole
          // transaction back; silently dropping the runs would leave the user
          // with a page they can see but can't edit.
          if (!pdfPageId) {
            throw new Error(`Page ${parsedPage.pageIndex} of ${doc.id} vanished mid-transaction`);
          }

          return parsedPage.runs.map((run) => ({
            pdfPageId,
            x: run.x,
            y: run.y,
            width: run.width,
            height: run.height,
            baseline: run.baseline,
            fontFamily: run.fontFamily,
            fontSource: run.fontSource,
            embeddedFontUrl: run.embeddedFontKey,
            fontSize: run.fontSize,
            color: run.color,
            backgroundColor: run.backgroundColor,
            originalText: run.originalText,
            text: run.originalText,
          }));
        });

        // Chunked because createMany binds one parameter per column per row and
        // Postgres caps a statement at 65535 of them.
        for (let i = 0; i < runRows.length; i += RUN_INSERT_CHUNK) {
          await tx.pdfTextRun.createMany({ data: runRows.slice(i, i + RUN_INSERT_CHUNK) });
        }
      },
      {
        // Well clear of what the statements above need, so a slow database on a
        // large document fails as a real error rather than as a timeout.
        maxWait: 15_000,
        timeout: 120_000,
      },
    );

    const persisted = await findOwnedDocument(doc.id, req.userId);
    res.status(201).json({ document: serializePdfDocument(persisted) });
  }),
);

pdfsRouter.get(
  "/:id",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const doc = await findOwnedDocument(req.params.id!, req.userId);
    res.json({ document: serializePdfDocument(doc) });
  }),
);

pdfsRouter.patch(
  "/:id",
  validateBody(renamePdfDocumentBodySchema),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { title } = req.body;

    const { count } = await prisma.pdfDocument.updateMany({
      where: { id: req.params.id!, userId: req.userId },
      data: { title },
    });

    if (count === 0) throw notFound("PDF document");

    const doc = await findOwnedDocument(req.params.id!, req.userId);
    res.json({ document: serializePdfDocument(doc) });
  }),
);

pdfsRouter.delete(
  "/:id",
  asyncHandler<AuthedRequest>(async (req, res) => {
    // Cascade deletes PdfPage and PdfTextRun; we still delete blobs explicitly.
    const { count } = await prisma.pdfDocument.deleteMany({
      where: { id: req.params.id!, userId: req.userId },
    });
    if (count === 0) throw notFound("PDF document");

    await storage.deletePrefix(storageKeys.document(req.userId, req.params.id!));
    res.status(204).end();
  }),
);

/** Autosave target for one text run. Mirrors `PATCH /resumes/:id`. */
pdfsRouter.patch(
  "/:id/runs/:runId",
  validateBody(updatePdfTextRunBodySchema),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { text } = req.body;

    // The ownership check is transitive: run → page → document → user. Enforcing
    // it in one query is verbose but keeps authorization in the WHERE clause.
    const run = await prisma.pdfTextRun.findFirst({
      where: {
        id: req.params.runId!,
        page: { document: { id: req.params.id!, userId: req.userId } },
      },
    });

    if (!run) throw notFound("Text run");

    await prisma.pdfTextRun.update({
      where: { id: run.id },
      data: { text },
    });

    res.status(204).end();
  }),
);

/**
 * Serves one page's backdrop image with hard caching. The URL carries a version
 * query param that changes only when the document is re-parsed, so the browser
 * can cache these forever without ever showing a stale image.
 */
pdfsRouter.get(
  "/:id/pages/:pageIndex/image",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const pageIndex = Number(req.params.pageIndex);
    if (!Number.isInteger(pageIndex) || pageIndex < 0) {
      throw badRequest("Invalid page index");
    }

    const page = await prisma.pdfPage.findFirst({
      where: {
        document: { id: req.params.id!, userId: req.userId },
        pageIndex,
      },
    });

    if (!page) throw notFound("Page");

    const obj = await storage.get(page.backgroundImageUrl);
    if (!obj) throw notFound("Page image");

    res.setHeader("Content-Type", obj.contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.end(obj.bytes);
  }),
);

/**
 * Serves one embedded font program. The editor declares these via `@font-face`
 * after the document loads, then the browser fetches them as needed.
 */
pdfsRouter.get(
  "/:id/fonts/:file",
  asyncHandler<AuthedRequest>(async (req, res) => {
    // Ownership confirmation: the document must belong to the caller. The file
    // itself isn't in the database, but its storage key is namespaced by document.
    const doc = await prisma.pdfDocument.findFirst({
      where: { id: req.params.id!, userId: req.userId },
      select: { id: true },
    });
    if (!doc) throw notFound("PDF document");

    // Font keys are `users/<userId>/pdfs/<docId>/fonts/<file>`, so we reconstruct
    // the full key from the route params. The file name came from the serializer,
    // which got it from the database, so it's already safe — but we still check.
    const file = req.params.file!;
    if (!file || file.includes("..") || file.includes("/") || file.includes("\\")) {
      throw badRequest("Invalid font file name");
    }

    const key = `users/${req.userId}/pdfs/${doc.id}/fonts/${file}`;
    const obj = await storage.get(key);
    if (!obj) throw notFound("Font file");

    res.setHeader("Content-Type", obj.contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.end(obj.bytes);
  }),
);

/**
 * Exports the edited PDF by redacting-and-redrawing every edited run onto the
 * original upload. Unedited runs and all non-text content are left byte-identical.
 */
pdfsRouter.get(
  "/:id/export.pdf",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const doc = await findOwnedDocument(req.params.id!, req.userId);
    const bytes = await exportEditedPdf(doc);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${doc.title}.pdf"`);
    res.end(Buffer.from(bytes));
  }),
);
