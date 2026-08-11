import { Router } from "express";
import { prisma } from "@repo/db";
import { jdExcerpt } from "@repo/scoring";
import {
  compareJdBodySchema,
  jdKeywordSchema,
  jdSuggestionSchema,
  type JdComparisonDto,
  type JdKeyword,
  type JdSuggestion,
} from "@repo/types";
import { z } from "zod";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { asyncHandler, notFound, validateBody } from "../middleware/errors.js";
import { parseContent } from "../serializers.js";
import { streamChatTurn } from "../services/chat-stream.js";
import { compareToJd } from "../services/jd-match.js";
import { findOwnedResume } from "./resumes.js";

/**
 * Job-description matching.
 *
 * The endpoint worth reading is the last one. "Apply with AI" takes a comparison
 * id and a suggestion id and nothing else — the instruction that reaches the
 * model is read out of the stored row, not sent up from the browser. That is
 * deliberate: an endpoint that accepted arbitrary instruction text would be a
 * prompt passthrough wearing a button, and the fact that the suggestion was
 * computed from a real gap would stop being true.
 */

export const jdRouter = Router();

jdRouter.use(requireAuth);

/** How many past comparisons the panel lists. */
const HISTORY_LIMIT = 20;

const storedKeywordsSchema = z.array(jdKeywordSchema);
const storedSuggestionsSchema = z.array(jdSuggestionSchema);

const applyBodySchema = z.object({
  suggestionId: z.string().min(1).max(120),
});

function parseKeywords(value: unknown): JdKeyword[] {
  const parsed = storedKeywordsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

function parseSuggestions(value: unknown): JdSuggestion[] {
  const parsed = storedSuggestionsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/**
 * Reads a stored row back into the wire shape.
 *
 * Every JSON column is re-validated rather than cast: a row written by an
 * earlier shape of this feature should degrade to an empty list, not crash the
 * panel that loads it.
 */
function serializeComparison(row: {
  id: string;
  jobDescriptionText: string;
  matchScore: number;
  matchedKeywords: unknown;
  missingKeywords: unknown;
  suggestions: unknown;
  createdAt: Date;
}): JdComparisonDto {
  return {
    id: row.id,
    jobDescriptionText: row.jobDescriptionText,
    matchScore: row.matchScore,
    matchedKeywords: parseKeywords(row.matchedKeywords),
    missingKeywords: parseKeywords(row.missingKeywords),
    suggestions: parseSuggestions(row.suggestions),
    createdAt: row.createdAt.toISOString(),
  };
}

jdRouter.post(
  "/:id/jd-compare",
  validateBody(compareJdBodySchema),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { jobDescriptionText } = req.body as { jobDescriptionText: string };
    const resume = await findOwnedResume(req.params.id!, req.userId);

    const outcome = await compareToJd({
      content: parseContent(resume.content),
      jobDescriptionText,
      userId: req.userId,
    });

    // Stored even when the AI half failed. The keyword diff is the part the
    // cover letter and the history list read back, and it ran.
    const row = await prisma.jdComparison.create({
      data: {
        resumeId: resume.id,
        jobDescriptionText,
        matchScore: outcome.matchScore,
        matchedKeywords: outcome.matched,
        missingKeywords: outcome.missing,
        suggestions: outcome.suggestions,
      },
    });

    res.json({ comparison: serializeComparison(row), aiError: outcome.aiError });
  }),
);

jdRouter.get(
  "/:id/jd-compare",
  asyncHandler<AuthedRequest>(async (req, res) => {
    await findOwnedResume(req.params.id!, req.userId);

    const rows = await prisma.jdComparison.findMany({
      where: { resumeId: req.params.id! },
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
      // The posting body is only needed to build the excerpt; sending twenty
      // full JDs to render a list of labels would be wasteful.
      select: { id: true, matchScore: true, jobDescriptionText: true, createdAt: true },
    });

    res.json({
      comparisons: rows.map((row) => ({
        id: row.id,
        matchScore: row.matchScore,
        excerpt: jdExcerpt(row.jobDescriptionText),
        createdAt: row.createdAt.toISOString(),
      })),
    });
  }),
);

jdRouter.get(
  "/:id/jd-compare/:comparisonId",
  asyncHandler<AuthedRequest>(async (req, res) => {
    await findOwnedResume(req.params.id!, req.userId);

    // Scoped by resumeId as well as its own id, so a valid comparison id from
    // someone else's resume doesn't resolve just because the caller owns *a*
    // resume.
    const row = await prisma.jdComparison.findFirst({
      where: { id: req.params.comparisonId!, resumeId: req.params.id! },
    });
    if (!row) throw notFound("Comparison");

    res.json({ comparison: serializeComparison(row), aiError: null });
  }),
);

/**
 * "Apply with AI" — hands one stored suggestion to the chat assistant.
 *
 * Streams the same SSE events as `POST /resumes/:id/chat`, so the panel reuses
 * the editor's existing apply-and-undo path unchanged: the resulting document
 * lands on the client's history stack as one step, exactly like a typed request.
 */
jdRouter.post(
  "/:id/jd-compare/:comparisonId/apply",
  validateBody(applyBodySchema),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { suggestionId } = req.body as { suggestionId: string };

    // Everything that can fail with a status code happens before a byte of the
    // stream is written.
    const resume = await findOwnedResume(req.params.id!, req.userId);

    const row = await prisma.jdComparison.findFirst({
      where: { id: req.params.comparisonId!, resumeId: resume.id },
    });
    if (!row) throw notFound("Comparison");

    const suggestion = parseSuggestions(row.suggestions).find((item) => item.id === suggestionId);
    if (!suggestion) throw notFound("Suggestion");

    await streamChatTurn({
      res,
      resume,
      userId: req.userId,
      // The instruction the server composed when it found the gap — never text
      // from the request body.
      message: [
        suggestion.instruction,
        "",
        "This came from a job-posting comparison. Make only this change. If the resume does not genuinely support it, make no change and say so in one line.",
      ].join("\n"),
      // The transcript reads as the user asking for the gap to be closed, so the
      // conversation stays legible next to whatever they typed before it.
      transcriptText: `Apply this job-match suggestion: ${suggestion.message}`,
    });
  }),
);
