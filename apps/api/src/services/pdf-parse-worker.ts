/**
 * Runs one PDF parse to completion in this process, then exits.
 *
 * Invoked by `pdf-parse-job.ts` as a child process — never imported. Everything
 * it produces (page backdrops, extracted font programs) goes straight into blob
 * storage; only the metadata comes back, as one JSON line on stdout.
 *
 * The entry point at the bottom runs on import, so importing this module from the
 * parent would exit the parent. The shared types live in `pdf-parse-protocol.ts`
 * for exactly that reason.
 *
 * Why a child process at all: `pdfjs-dist` + `@napi-rs/canvas` intermittently
 * segfault under Bun on Windows, and a segfault is not catchable — in-process it
 * would take the whole API down mid-request. Out here it's an exit code the
 * supervisor can retry. Parsing is also CPU-bound on attacker-supplied input, so
 * the isolation is worth having on its own merits.
 */
import { storage, storageKeys, contentHash, fontExtensionFor } from "./storage";
import { NoTextLayerError, TooManyPagesError, UnreadablePdfError, parsePdf } from "./pdf-parse";
import { config } from "../config";
import {
  RESULT_SENTINEL,
  type ParseJob,
  type ParseJobPage,
  type ParseJobResult,
} from "./pdf-parse-protocol";

async function run(job: ParseJob): Promise<ParseJobResult> {
  const source = await storage.get(job.sourceKey);
  if (!source) return { ok: false, code: "INTERNAL", message: "Uploaded file is missing." };

  const parsed = await parsePdf(new Uint8Array(source.bytes), job.documentId, {
    maxPages: config.maxPdfPages,
  });

  // Font programs first: a run can't reference a key that isn't written yet.
  const fontKeys = new Map<string, string>();
  for (const [id, program] of parsed.fontPrograms) {
    const key = storageKeys.font(
      job.userId,
      job.documentId,
      program.family,
      fontExtensionFor(program.mimeType),
    );
    await storage.put(key, Buffer.from(program.bytes), program.mimeType);
    fontKeys.set(id, key);
  }

  const pages: ParseJobPage[] = [];
  for (const page of parsed.pages) {
    const backgroundKey = storageKeys.pageImage(job.userId, job.documentId, page.pageIndex);
    await storage.put(backgroundKey, page.image, "image/png");

    pages.push({
      pageIndex: page.pageIndex,
      width: page.width,
      height: page.height,
      backgroundKey,
      backgroundVersion: contentHash(page.image),
      runs: page.runs.map(({ fontProgramId, ...run }) => ({
        ...run,
        embeddedFontKey: fontProgramId ? (fontKeys.get(fontProgramId) ?? null) : null,
      })),
    });
  }

  return { ok: true, pageCount: parsed.pageCount, pages };
}

// --- Entry point ---

const raw = process.argv[2];
if (!raw) {
  process.stderr.write("pdf-parse-worker: missing job argument\n");
  process.exit(2);
}

let result: ParseJobResult;
try {
  result = await run(JSON.parse(raw) as ParseJob);
} catch (error) {
  // Expected failures are reported as data so the supervisor can tell them from
  // a crash and skip the retry — a scan won't parse on the second attempt either.
  if (error instanceof NoTextLayerError) {
    result = { ok: false, code: "NO_TEXT_LAYER", message: error.message };
  } else if (error instanceof UnreadablePdfError) {
    result = { ok: false, code: "UNREADABLE", message: error.message };
  } else if (error instanceof TooManyPagesError) {
    result = { ok: false, code: "TOO_MANY_PAGES", message: error.message };
  } else {
    process.stderr.write(`pdf-parse-worker: ${(error as Error)?.stack ?? String(error)}\n`);
    result = { ok: false, code: "INTERNAL", message: "Could not process this PDF." };
  }
}

process.stdout.write(RESULT_SENTINEL + JSON.stringify(result) + "\n");
// Explicit, because pdfjs and the canvas binding both leave handles open and the
// process would otherwise sit there until the supervisor's timeout fires.
process.exit(0);
