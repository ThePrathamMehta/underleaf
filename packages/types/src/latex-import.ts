import { z } from "zod";
import { resumeContentSchema } from "./content";

/**
 * Wire types for pasting an existing LaTeX resume in.
 *
 * The endpoint is unusual in this codebase for returning content it does *not*
 * save: extraction is a guess, however good, and the user gets to see it in the
 * editor before anything is persisted. So the response carries the content plus
 * enough context for the client to say how much to trust it.
 */

/**
 * How much LaTeX one paste may carry.
 *
 * A resume `.tex` is 5–15KB; the room above that is for the preamble, comments and
 * commented-out history real documents accumulate. Well under the API's 2mb JSON
 * limit, so the cap that rejects an oversized paste is this one, with a message
 * about LaTeX, rather than a bare 413 from the body parser.
 */
export const LATEX_SOURCE_MAX = 200_000;

export const latexImportBodySchema = z.object({
  latexSource: z.string().min(1).max(LATEX_SOURCE_MAX),
});

export type LatexImportBody = z.infer<typeof latexImportBodySchema>;

/**
 * How the content was arrived at.
 *
 * `deterministic` means the parser recognised the document's structure outright —
 * the fields are as exact as the source. `ai-assisted` means a model read it, and
 * the client shows the "please review" banner. The distinction is surfaced rather
 * than hidden because the two have genuinely different error profiles: a
 * deterministic miss drops a field, a model's miss can invent a plausible one.
 */
export const LATEX_IMPORT_CONFIDENCE = ["deterministic", "ai-assisted"] as const;

export const latexImportConfidenceSchema = z.enum(LATEX_IMPORT_CONFIDENCE);
export type LatexImportConfidence = z.infer<typeof latexImportConfidenceSchema>;

export const latexImportResultSchema = z.object({
  /** Extracted, validated, and deliberately not yet saved. */
  content: resumeContentSchema,
  confidence: latexImportConfidenceSchema,
  /**
   * Specific things the import could not do — a section it skipped, a field it
   * left empty, content it had to salvage from a reply that failed validation.
   *
   * The spec's bar is that a partial extraction never fails silently. A banner
   * saying "review this" clears it; naming what to review clears it better.
   */
  warnings: z.array(z.string().max(300)).max(12),
});

export type LatexImportResult = z.infer<typeof latexImportResultSchema>;

/**
 * The rate limit, shared so the enforcement and the error message can't disagree.
 *
 * Import is free on every plan — it's a one-time act per resume, not the recurring
 * generation that v5's allowance was designed to meter — so the only thing
 * standing between the AI fallback and a script is this. Ten an hour is far more
 * than anyone importing their own resume needs, and far less than an abuser wants.
 */
export const LATEX_IMPORT_RATE_LIMIT = { max: 10, windowMs: 60 * 60 * 1000 } as const;
