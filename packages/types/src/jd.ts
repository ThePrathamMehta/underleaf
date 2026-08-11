import { z } from "zod";

/**
 * Wire types for job-description matching.
 *
 * A matched keyword carries `evidence` — where in the resume it was found — and
 * a missing one carries `weight`, how much the JD leans on it. Both exist so the
 * result is arguable: a user who disagrees can see what the match was based on,
 * rather than being handed a number to trust.
 */

export const jdKeywordSchema = z.object({
  term: z.string(),
  /**
   * Roughly how central this is to the posting: how often it appears, lifted if
   * it shows up in a requirements list. Drives the sort order of the missing
   * column, so the biggest gaps are at the top.
   */
  weight: z.number().min(1),
  /** Where it was found in the resume. Null on the missing side. */
  evidence: z.string().nullable(),
});

export type JdKeyword = z.infer<typeof jdKeywordSchema>;

export const jdSuggestionSchema = z.object({
  id: z.string(),
  /** What to change, naming the specific gap. */
  message: z.string(),
  /** The section it concerns, so the panel can scroll the canvas to it. */
  sectionRef: z.string().nullable(),
  /**
   * The instruction handed to the chat assistant by "Apply with AI".
   *
   * Composed server-side rather than in the browser. The browser is welcome to
   * *ask* for a suggestion to be applied, but the words that reach the model
   * come from the same process that computed the gap — otherwise "Apply with AI"
   * is an arbitrary prompt endpoint wearing a button.
   */
  instruction: z.string(),
});

export type JdSuggestion = z.infer<typeof jdSuggestionSchema>;

export const jdComparisonSchema = z.object({
  id: z.string(),
  jobDescriptionText: z.string(),
  matchScore: z.number().min(0).max(100),
  matchedKeywords: z.array(jdKeywordSchema),
  missingKeywords: z.array(jdKeywordSchema),
  suggestions: z.array(jdSuggestionSchema),
  createdAt: z.string(),
});

export type JdComparisonDto = z.infer<typeof jdComparisonSchema>;

/** History rows omit the JD body and keyword lists; the list only needs a label. */
export const jdComparisonSummarySchema = z.object({
  id: z.string(),
  matchScore: z.number(),
  /** First line of the posting, trimmed — enough to tell two apart. */
  excerpt: z.string(),
  createdAt: z.string(),
});

export type JdComparisonSummary = z.infer<typeof jdComparisonSummarySchema>;

export const compareJdBodySchema = z.object({
  jobDescriptionText: z
    .string()
    .min(80, "Paste the full posting — a line or two isn't enough to compare against.")
    .max(20_000),
});

export type CompareJdBody = z.infer<typeof compareJdBodySchema>;

export const jdCompareResponseSchema = z.object({
  comparison: jdComparisonSchema,
  /** Non-null when the AI half failed; the keyword diff still ran. */
  aiError: z.string().nullable(),
});

export type JdCompareResponse = z.infer<typeof jdCompareResponseSchema>;
