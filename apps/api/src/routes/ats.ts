import { Router } from "express";
import { prisma } from "@repo/db";
import {
  atsCategoryScoresSchema,
  atsIssueSchema,
  type AtsCategoryScores,
  type AtsIssue,
  type AtsScoreResultDto,
} from "@repo/types";
import { z } from "zod";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { asyncHandler, notFound } from "../middleware/errors.js";
import { parseContent, parseTheme } from "../serializers.js";
import { scoreResume } from "../services/ats-score.js";
import { checkAndConsumeAiAction, refundAiAction } from "../services/entitlements.js";
import { findOwnedResume } from "./resumes.js";

/**
 * ATS scoring endpoints.
 *
 * Scoring runs on demand — `POST` — and never on a write. The spec is explicit
 * that it must not run per keystroke, and putting it behind an explicit action
 * is also what makes the history meaningful: every stored row is a moment the
 * user chose to measure, not a sample of a document mid-edit.
 */

export const atsRouter = Router();

atsRouter.use(requireAuth);

/** How many past runs the panel's trend line gets. */
const HISTORY_LIMIT = 20;

const storedIssuesSchema = z.array(atsIssueSchema);

const EMPTY_SCORES: AtsCategoryScores = {
  keywords: 0,
  formatting: 0,
  impact: 0,
  completeness: 0,
};

/**
 * Reads a stored row back into the wire shape.
 *
 * Both JSON columns are re-validated rather than cast. A row written by an
 * earlier shape of this feature should degrade to an empty list, not crash the
 * panel that loads it.
 */
function serializeResult(row: {
  id: string;
  overallScore: number;
  categoryScores: unknown;
  issues: unknown;
  aiAssisted: boolean;
  createdAt: Date;
}): AtsScoreResultDto {
  const scores = atsCategoryScoresSchema.safeParse(row.categoryScores);
  const issues = storedIssuesSchema.safeParse(row.issues);

  return {
    id: row.id,
    overallScore: row.overallScore,
    categoryScores: scores.success ? scores.data : EMPTY_SCORES,
    issues: issues.success ? issues.data : [],
    aiAssisted: row.aiAssisted,
    createdAt: row.createdAt.toISOString(),
  };
}

atsRouter.post(
  "/:id/ats-score",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const resume = await findOwnedResume(req.params.id!, req.userId);

    // Consumed before the call, because the check has to precede the spend and
    // there is no way to know from here whether the provider will answer.
    const action = await checkAndConsumeAiAction(req.userId, "ats");

    const outcome = await scoreResume({
      content: parseContent(resume.content),
      theme: parseTheme(resume.theme),
      templateSlug: resume.template.slug,
      userId: req.userId,
      planKey: action.planKey,
    });

    // The rule-based half is free and always runs (Section 0), so an AI half that
    // failed means the user got nothing they should be charged for. Refund and
    // report the restored count, rather than billing an action for a provider
    // outage.
    const usage = outcome.aiAssisted ? action.usage : await refundAiAction(req.userId);

    // Stored even when the AI half failed, with `aiAssisted: false` recording
    // that. A rule-only run is a real measurement; dropping it would leave a gap
    // in the trend line exactly when the user was trying to see progress.
    const row = await prisma.atsScoreResult.create({
      data: {
        resumeId: resume.id,
        overallScore: outcome.overallScore,
        categoryScores: outcome.categoryScores,
        issues: outcome.issues satisfies AtsIssue[],
        aiAssisted: outcome.aiAssisted,
      },
    });

    res.json({ result: serializeResult(row), aiError: outcome.aiError, usage });
  }),
);

atsRouter.get(
  "/:id/ats-score/latest",
  asyncHandler<AuthedRequest>(async (req, res) => {
    await findOwnedResume(req.params.id!, req.userId);

    const row = await prisma.atsScoreResult.findFirst({
      where: { resumeId: req.params.id! },
      orderBy: { createdAt: "desc" },
    });

    // 204 rather than 404: "you have never scored this" is a normal state for a
    // panel opening for the first time, not a missing resource.
    if (!row) {
      res.status(204).end();
      return;
    }

    res.json({ result: serializeResult(row), aiError: null });
  }),
);

atsRouter.get(
  "/:id/ats-score/history",
  asyncHandler<AuthedRequest>(async (req, res) => {
    await findOwnedResume(req.params.id!, req.userId);

    const rows = await prisma.atsScoreResult.findMany({
      where: { resumeId: req.params.id! },
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
      select: { id: true, overallScore: true, createdAt: true },
    });

    // Oldest first: the panel plots left to right, and reversing in the client
    // would mean every consumer of this endpoint had to remember to.
    res.json({
      history: rows.reverse().map((row) => ({
        id: row.id,
        overallScore: row.overallScore,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  }),
);

atsRouter.get(
  "/:id/ats-score/:resultId",
  asyncHandler<AuthedRequest>(async (req, res) => {
    await findOwnedResume(req.params.id!, req.userId);

    // Scoped by resumeId as well as its own id, so a valid result id from
    // someone else's resume doesn't resolve just because the caller owns *a*
    // resume.
    const row = await prisma.atsScoreResult.findFirst({
      where: { id: req.params.resultId!, resumeId: req.params.id! },
    });
    if (!row) throw notFound("Score");

    res.json({ result: serializeResult(row), aiError: null });
  }),
);
