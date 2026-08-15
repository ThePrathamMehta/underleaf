import { z } from "zod";
import { aiUsageSchema } from "./billing";

/**
 * Wire types for cover letters.
 *
 * The body is plain text with blank-line paragraph breaks, not the block
 * editor's structured content. A letter is prose: it has no sections to
 * reorder, no items to add, and nothing the pagination packer needs to measure.
 * Reusing that machinery would buy nothing and cost the user a heavier editor
 * than the task deserves.
 */

export const COVER_LETTER_TONES = ["formal", "friendly", "concise"] as const;
export const coverLetterToneSchema = z.enum(COVER_LETTER_TONES);
export type CoverLetterTone = z.infer<typeof coverLetterToneSchema>;

export const COVER_LETTER_TONE_LABELS: Record<CoverLetterTone, string> = {
  formal: "Formal",
  friendly: "Friendly",
  concise: "Concise",
};

export const COVER_LETTER_TONE_BLURBS: Record<CoverLetterTone, string> = {
  formal: "Measured and traditional. Safe for finance, law, government and academia.",
  friendly: "Warmer and more direct, with some personality. Suits startups and product teams.",
  concise: "Three short paragraphs, no throat-clearing. For readers who skim.",
};

export const coverLetterSchema = z.object({
  id: z.string(),
  resumeId: z.string(),
  jobDescriptionText: z.string().nullable(),
  content: z.string(),
  tone: coverLetterToneSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CoverLetterDto = z.infer<typeof coverLetterSchema>;

/**
 * The list shape. Carries an excerpt rather than the body: a dashboard listing
 * ten letters has no use for ten full letters, and sending them anyway is the
 * kind of thing that only shows up as a problem once someone has written ten.
 */
export const coverLetterSummarySchema = z.object({
  id: z.string(),
  resumeId: z.string(),
  excerpt: z.string(),
  tone: coverLetterToneSchema,
  updatedAt: z.string(),
});

export type CoverLetterSummary = z.infer<typeof coverLetterSummarySchema>;

/**
 * What generation returns.
 *
 * Unlike ATS and JD matching there is no `aiError` here, and that asymmetry is
 * deliberate: those two have a deterministic half that still produces a real
 * answer when the provider is down. A cover letter has no such half — a failed
 * generation is a failed request, and it surfaces as a status code with a
 * specific message rather than a success carrying an apology.
 */
export const coverLetterResponseSchema = z.object({
  letter: coverLetterSchema,
  /** True when the JD was reused from a past comparison rather than supplied. */
  reusedJobDescription: z.boolean(),
  /**
   * The allowance after this generation (v5 Section 6).
   *
   * Always present on a generate, never on a read: unlike ATS and JD matching
   * there is no deterministic half here, so a letter that exists is a letter the
   * model wrote, and the action is always spent.
   */
  usage: aiUsageSchema.optional(),
});

export type CoverLetterResponse = z.infer<typeof coverLetterResponseSchema>;

/**
 * The panel's initial load: the list, plus the newest letter in full.
 *
 * One request rather than two, because the panel needs both on mount and a
 * round trip to fetch a row already in hand is a round trip spent for nothing.
 */
export const coverLetterListResponseSchema = z.object({
  letters: z.array(coverLetterSummarySchema),
  latest: coverLetterSchema.nullable(),
});

export type CoverLetterListResponse = z.infer<typeof coverLetterListResponseSchema>;

export const generateCoverLetterBodySchema = z.object({
  tone: coverLetterToneSchema.default("formal"),
  /**
   * Optional: when omitted the server reuses the most recent JD this resume was
   * compared against, so someone who has already used JD match doesn't paste the
   * same posting twice. Pass an empty string to deliberately generate without one.
   */
  jobDescriptionText: z.string().max(20_000).nullable().optional(),
  /**
   * Supplied when regenerating, so a second attempt replaces the letter instead
   * of leaving a pile of near-identical drafts behind.
   */
  coverLetterId: z.string().optional(),
});

export type GenerateCoverLetterBody = z.infer<typeof generateCoverLetterBodySchema>;

export const updateCoverLetterBodySchema = z.object({
  content: z.string().max(20_000).optional(),
  tone: coverLetterToneSchema.optional(),
});

export type UpdateCoverLetterBody = z.infer<typeof updateCoverLetterBodySchema>;
