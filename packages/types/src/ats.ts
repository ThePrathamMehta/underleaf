import { z } from "zod";
import { aiUsageSchema } from "./billing";

/**
 * Wire types for ATS scoring.
 *
 * The shape is built around the spec's requirement that guidance be
 * "resume-anchored": every issue carries a `fix` (what to do) and a `sectionRef`
 * (where to do it). An issue with neither is generic advice with nothing to
 * click, which is the failure mode the Definition of Done names explicitly — so
 * `fix` is required, and `sectionRef` is only nullable for the handful of checks
 * that genuinely concern the document as a whole.
 */

export const ATS_CATEGORIES = ["keywords", "formatting", "impact", "completeness"] as const;
export const atsCategorySchema = z.enum(ATS_CATEGORIES);
export type AtsCategory = z.infer<typeof atsCategorySchema>;

export const ATS_CATEGORY_LABELS: Record<AtsCategory, string> = {
  keywords: "Keywords & skills",
  formatting: "Parseability",
  impact: "Impact",
  completeness: "Completeness",
};

export const ATS_CATEGORY_BLURBS: Record<AtsCategory, string> = {
  keywords: "Whether the skills and tools a scanner looks for are actually present as text.",
  formatting: "Whether an automated parser can read the layout, headers and dates without guessing.",
  impact: "Whether bullets describe outcomes with numbers rather than listing duties.",
  completeness: "Whether the sections and contact details a recruiter expects are all there.",
};

export const ATS_SEVERITIES = ["critical", "warning", "suggestion"] as const;
export const atsSeveritySchema = z.enum(ATS_SEVERITIES);
export type AtsSeverity = z.infer<typeof atsSeveritySchema>;

/** Sort weight, so the panel and the API agree on what "prioritized" means. */
export const ATS_SEVERITY_RANK: Record<AtsSeverity, number> = {
  critical: 0,
  warning: 1,
  suggestion: 2,
};

export const atsIssueSchema = z.object({
  id: z.string(),
  severity: atsSeveritySchema,
  category: atsCategorySchema,
  /** What is wrong, naming the specific thing. */
  message: z.string(),
  /** What to do about it. Required — an issue without a fix is a complaint. */
  fix: z.string(),
  /** Section id in the resume's own content, or null for whole-document issues. */
  sectionRef: z.string().nullable(),
});

export type AtsIssue = z.infer<typeof atsIssueSchema>;

export const atsCategoryScoresSchema = z.object({
  keywords: z.number().min(0).max(100),
  formatting: z.number().min(0).max(100),
  impact: z.number().min(0).max(100),
  completeness: z.number().min(0).max(100),
});

export type AtsCategoryScores = z.infer<typeof atsCategoryScoresSchema>;

export const atsScoreResultSchema = z.object({
  id: z.string(),
  overallScore: z.number().min(0).max(100),
  categoryScores: atsCategoryScoresSchema,
  issues: z.array(atsIssueSchema),
  /**
   * False when the provider was unreachable and this is the deterministic half
   * alone. Surfaced in the panel rather than swallowed: a 78 from six checks and
   * a 78 from ten checks mean different things.
   */
  aiAssisted: z.boolean(),
  createdAt: z.string(),
});

export type AtsScoreResultDto = z.infer<typeof atsScoreResultSchema>;

/** History entries omit the issue list — the panel only plots score over time. */
export const atsHistoryEntrySchema = z.object({
  id: z.string(),
  overallScore: z.number(),
  createdAt: z.string(),
});

export type AtsHistoryEntry = z.infer<typeof atsHistoryEntrySchema>;

export const atsScoreResponseSchema = z.object({
  result: atsScoreResultSchema,
  /**
   * Non-null when the AI half failed. The score is still returned — a partial
   * answer beats an error page — but the reason travels with it so the panel can
   * say which checks are missing instead of showing a quietly lower number.
   */
  aiError: z.string().nullable(),
  /**
   * The allowance after this run (v5 Section 6).
   *
   * Optional because three of the four endpoints in this file are reads that
   * cost nothing, and a scored run that was refunded — the AI half didn't
   * happen — reports the refunded count rather than pretending an action was
   * spent.
   */
  usage: aiUsageSchema.optional(),
});

export type AtsScoreResponse = z.infer<typeof atsScoreResponseSchema>;
