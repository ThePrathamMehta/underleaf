import { Router } from "express";
import { prisma } from "@repo/db";
import {
  coverLetterToneSchema,
  generateCoverLetterBodySchema,
  updateCoverLetterBodySchema,
  type CoverLetterDto,
  type CoverLetterTone,
} from "@repo/types";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { asyncHandler, notFound, validateBody } from "../middleware/errors.js";
import { parseContent, parseTheme } from "../serializers.js";
import { generateCoverLetter } from "../services/cover-letter.js";
import { renderCoverLetterHtml } from "../services/cover-letter-pdf.js";
import { exportHtmlPdf } from "../services/pdf.js";
import { findOwnedResume } from "./resumes.js";

/**
 * Cover letters.
 *
 * Two routers, because the resources are addressed differently: generating and
 * listing are nested under a resume, while editing and exporting are addressed by
 * letter id. Both are owner-scoped in the WHERE clause rather than by a check
 * after the read — the row simply doesn't resolve for the wrong user.
 */

export const resumeCoverLettersRouter = Router();
export const coverLettersRouter = Router();

resumeCoverLettersRouter.use(requireAuth);
coverLettersRouter.use(requireAuth);

/** How many letters the list returns. More than this is an archive, not a list. */
const LIST_LIMIT = 20;

/** Enough of the opening to recognise which letter this is. */
const EXCERPT_LENGTH = 100;

function excerpt(content: string): string {
  const opening = content
    .replace(/\r\n/g, "\n")
    // The salutation is the same on every letter, so it identifies none of them.
    .replace(/^\s*(dear|to whom|hello|hi)\b[^\n]*\n+/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return opening.length > EXCERPT_LENGTH ? `${opening.slice(0, EXCERPT_LENGTH)}…` : opening;
}

/** Tones are a closed set; a row written before one was removed reads as formal. */
function parseTone(value: string): CoverLetterTone {
  const parsed = coverLetterToneSchema.safeParse(value);
  return parsed.success ? parsed.data : "formal";
}

function serializeLetter(row: {
  id: string;
  resumeId: string;
  jobDescriptionText: string | null;
  content: string;
  tone: string;
  createdAt: Date;
  updatedAt: Date;
}): CoverLetterDto {
  return {
    id: row.id,
    resumeId: row.resumeId,
    jobDescriptionText: row.jobDescriptionText,
    content: row.content,
    tone: parseTone(row.tone),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Generates a letter, or regenerates one in place.
 *
 * The JD is optional in the body and looked up when absent: someone who already
 * compared this resume against a posting in the JD panel should not have to paste
 * it a second time. `reusedJobDescription` tells the panel which happened, so it
 * can say so rather than leaving the user guessing what the letter was written
 * against.
 */
resumeCoverLettersRouter.post(
  "/:id/cover-letter",
  validateBody(generateCoverLetterBodySchema),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const body = req.body as {
      tone: CoverLetterTone;
      jobDescriptionText?: string | null;
      coverLetterId?: string;
    };

    const resume = await findOwnedResume(req.params.id!, req.userId);

    // An empty string is an explicit "no posting"; undefined means "use whatever
    // you have". Distinguishing them is why the field is nullable *and* optional.
    let jobDescriptionText = body.jobDescriptionText?.trim() || null;
    let reusedJobDescription = false;

    if (body.jobDescriptionText === undefined) {
      const latest = await prisma.jdComparison.findFirst({
        where: { resumeId: resume.id },
        orderBy: { createdAt: "desc" },
        select: { jobDescriptionText: true },
      });
      if (latest) {
        jobDescriptionText = latest.jobDescriptionText;
        reusedJobDescription = true;
      }
    }

    // Generation happens before any write, so a provider failure leaves whatever
    // letter already existed untouched rather than blanking it.
    const content = await generateCoverLetter({
      content: parseContent(resume.content),
      tone: body.tone,
      jobDescriptionText,
      userId: req.userId,
    });

    // Regenerating replaces: a tone experiment shouldn't leave five near
    // identical drafts behind. Scoped by userId so an id from another account
    // updates nothing.
    if (body.coverLetterId) {
      const updated = await prisma.coverLetter.updateMany({
        where: { id: body.coverLetterId, userId: req.userId, resumeId: resume.id },
        data: { content, tone: body.tone, jobDescriptionText },
      });

      if (updated.count > 0) {
        const row = await prisma.coverLetter.findFirstOrThrow({
          where: { id: body.coverLetterId },
        });
        res.json({ letter: serializeLetter(row), reusedJobDescription });
        return;
      }
      // Fell through: the id didn't resolve, so this becomes a fresh letter
      // rather than a 404 that discards a completion the user already paid for.
    }

    const row = await prisma.coverLetter.create({
      data: {
        resumeId: resume.id,
        userId: req.userId,
        jobDescriptionText,
        content,
        tone: body.tone,
      },
    });

    res.status(201).json({ letter: serializeLetter(row), reusedJobDescription });
  }),
);

/** The letters for one resume, newest first. */
resumeCoverLettersRouter.get(
  "/:id/cover-letter",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const resume = await findOwnedResume(req.params.id!, req.userId);

    const rows = await prisma.coverLetter.findMany({
      where: { resumeId: resume.id, userId: req.userId },
      orderBy: { updatedAt: "desc" },
      take: LIST_LIMIT,
    });

    res.json({
      letters: rows.map((row) => ({
        id: row.id,
        resumeId: row.resumeId,
        excerpt: excerpt(row.content),
        tone: parseTone(row.tone),
        updatedAt: row.updatedAt.toISOString(),
      })),
      // Saves the panel a second request purely to prefill the paste box.
      latest: rows[0] ? serializeLetter(rows[0]) : null,
    });
  }),
);

coverLettersRouter.get(
  "/:letterId",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const row = await prisma.coverLetter.findFirst({
      where: { id: req.params.letterId!, userId: req.userId },
    });
    if (!row) throw notFound("Cover letter");

    res.json({ letter: serializeLetter(row) });
  }),
);

/** The autosave target for hand edits. Same debounce contract as the resume. */
coverLettersRouter.patch(
  "/:letterId",
  validateBody(updateCoverLetterBodySchema),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const body = req.body as { content?: string; tone?: CoverLetterTone };

    const updated = await prisma.coverLetter.updateMany({
      where: { id: req.params.letterId!, userId: req.userId },
      data: {
        ...(body.content !== undefined ? { content: body.content } : {}),
        ...(body.tone !== undefined ? { tone: body.tone } : {}),
      },
    });
    if (updated.count === 0) throw notFound("Cover letter");

    const row = await prisma.coverLetter.findFirstOrThrow({
      where: { id: req.params.letterId! },
    });

    res.json({ letter: serializeLetter(row) });
  }),
);

coverLettersRouter.delete(
  "/:letterId",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const deleted = await prisma.coverLetter.deleteMany({
      where: { id: req.params.letterId!, userId: req.userId },
    });
    if (deleted.count === 0) throw notFound("Cover letter");

    res.status(204).end();
  }),
);

/**
 * The printed letter.
 *
 * Reads the resume's theme through the relation so the letter prints in the same
 * typeface and margin as the resume it accompanies — the pair should look like one
 * application, not two documents that happened to arrive together.
 */
coverLettersRouter.get(
  "/:letterId/export.pdf",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const row = await prisma.coverLetter.findFirst({
      where: { id: req.params.letterId!, userId: req.userId },
      include: { resume: true },
    });
    if (!row) throw notFound("Cover letter");

    const pdf = await exportHtmlPdf(
      renderCoverLetterHtml({
        content: row.content,
        personalInfo: parseContent(row.resume.content).personalInfo,
        theme: parseTheme(row.resume.theme),
      }),
    );

    const base =
      row.resume.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "cover-letter";

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${base}-cover-letter.pdf"`);
    res.setHeader("Content-Length", pdf.byteLength);
    res.end(Buffer.from(pdf));
  }),
);
