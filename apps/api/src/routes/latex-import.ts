import { Router } from "express";
import {
  LATEX_IMPORT_RATE_LIMIT,
  latexImportBodySchema,
  type LatexImportResult,
} from "@repo/types";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { asyncHandler, validateBody } from "../middleware/errors.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { resolveEntitlement } from "../services/entitlements.js";
import { importLatexResume } from "../services/latex-import.js";

/**
 * Importing an existing LaTeX resume.
 *
 * Two things about this endpoint are deliberate and worth not undoing.
 *
 * It **saves nothing**. The response is content the browser holds and posts back
 * to `POST /resumes` if the user likes it. Import is a guess — a good one, but a
 * guess — and creating the resume here would mean a bad guess left a document in
 * someone's dashboard that they have to go and delete.
 *
 * It is **not metered**. Deliberately not routed through `checkAndConsumeAiAction`
 * and deliberately not part of the plan allowance: importing is how a user *gets
 * their resume in*, and charging an AI action for the privilege would make the
 * free tier's first act cost it something. It is guarded by attempts per hour
 * instead, and — like every provider call in the app — still lands in
 * `AiUsageLog`, so what it costs is visible even though nobody is billed for it.
 */

export const latexImportRouter = Router();

latexImportRouter.use(requireAuth);

/** Shared with the browser through `@repo/types`, so the copy and the limit
 *  can't drift apart. */
const limiter = rateLimit({
  max: LATEX_IMPORT_RATE_LIMIT.max,
  windowMs: LATEX_IMPORT_RATE_LIMIT.windowMs,
  message: (minutes) =>
    `That's ${LATEX_IMPORT_RATE_LIMIT.max} imports in an hour — try again in ${minutes} minute${minutes === 1 ? "" : "s"}. Editing your resume isn't affected.`,
});

latexImportRouter.post(
  "/import/latex",
  limiter,
  validateBody(latexImportBodySchema),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { latexSource } = req.body as { latexSource: string };

    // Read, not consumed: the plan decides which model reads the source, and
    // nothing about this request spends the allowance it belongs to.
    const entitlement = await resolveEntitlement(req.userId);

    const result: LatexImportResult = await importLatexResume({
      latexSource,
      userId: req.userId,
      planKey: entitlement.planKey,
    });

    res.json(result);
  }),
);
