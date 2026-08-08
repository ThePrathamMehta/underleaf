/**
 * The contract between `pdf-parse-job.ts` (parent) and `pdf-parse-worker.ts`
 * (child): the job that goes in, the result that comes back, and the marker that
 * identifies it on stdout.
 *
 * This is a separate module purely so the parent never has to import the worker.
 * The worker is an executable script — importing it runs its entry point, which
 * in a process with no job argument exits immediately and takes the parent with it.
 */
import type { ParsedRun } from "./pdf-parse";

/**
 * Marks the one line of stdout that is our result. pdfjs writes warnings to
 * stdout, so the supervisor needs something unambiguous to look for.
 */
export const RESULT_SENTINEL = "__PDF_PARSE_RESULT__";

export interface ParseJob {
  userId: string;
  documentId: string;
  sourceKey: string;
}

export interface ParseJobRun extends Omit<ParsedRun, "fontProgramId"> {
  /** Storage key of the embedded font program, when this run uses one. */
  embeddedFontKey: string | null;
}

export interface ParseJobPage {
  pageIndex: number;
  width: number;
  height: number;
  /** Storage key of the rendered backdrop. */
  backgroundKey: string;
  /** Cache-busting fingerprint of the backdrop bytes. */
  backgroundVersion: string;
  runs: ParseJobRun[];
}

export type ParseJobResult =
  | { ok: true; pageCount: number; pages: ParseJobPage[] }
  | { ok: false; code: ParseFailureCode; message: string };

/**
 * `NO_TEXT_LAYER` and `UNREADABLE` are verdicts about the file and are safe to
 * show the user as-is; `INTERNAL` is ours and is the only one worth retrying.
 */
export type ParseFailureCode = "NO_TEXT_LAYER" | "UNREADABLE" | "INTERNAL";
