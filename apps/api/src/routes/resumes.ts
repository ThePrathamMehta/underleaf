import { Router } from "express";
import { prisma } from "@repo/db";
import {
  createResumeBodySchema,
  createBlankCanvasContent,
  createBlankContent,
  createEmptyContent,
  contentDispositionAttachment,
  exportQuerySchema,
  getExportFilename,
  isBlankTemplate,
  resumeContentSchema,
  themeSchema,
  updateResumeBodySchema,
  type PageSize,
} from "@repo/types";
import { asyncHandler, notFound, validateBody, validateQuery } from "../middleware/errors.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { parseContent, parseTheme, serializeResumeWithTemplate } from "../serializers.js";
import { exportResumePdf } from "../services/pdf.js";
import { inlineResumeImages } from "../services/resume-images.js";

export const resumesRouter = Router();

// Every route below is owner-scoped. This is the app's main authorization
// surface, so the userId filter belongs in the query itself — never a
// post-fetch check that a later refactor could drop.
resumesRouter.use(requireAuth);

/** Loads a resume only if it belongs to the caller; 404s rather than 403s so
 * the endpoint doesn't confirm that someone else's id exists.
 *
 * Exported because every v4 feature that hangs off a resume — chat, ATS, JD
 * matching, cover letters — needs the same check, and an authorization rule
 * copied into five files is one refactor away from being four. */
export async function findOwnedResume(id: string, userId: string) {
  const resume = await prisma.resume.findFirst({
    where: { id, userId },
    include: { template: true },
  });
  if (!resume) throw notFound("Resume");
  return resume;
}

resumesRouter.get(
  "/",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const resumes = await prisma.resume.findMany({
      where: { userId: req.userId },
      include: { template: true },
      orderBy: { updatedAt: "desc" },
    });

    res.json({ resumes: resumes.map(serializeResumeWithTemplate) });
  }),
);

resumesRouter.post(
  "/",
  validateBody(createResumeBodySchema),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { templateId, title, blank, profession, importedContent } = req.body;

    const template = await prisma.template.findFirst({
      where: { OR: [{ id: templateId }, { slug: templateId }] },
    });
    if (!template) throw notFound("Template");

    /**
     * The Blank template is a canvas rather than a layout, so it starts from the
     * canvas scaffold — one empty heading waiting to be typed in — and ignores
     * both the `blank` flag and the profession the user was browsing. Neither has
     * anything to say about a document with no sections in it: `createBlankContent`
     * would scaffold three sections the canvas can't lay out, and a profession
     * sample would fill the page with exactly the structure the user just chose
     * not to have.
     *
     * Imported content outranks it, because that content is *sections* — a canvas
     * would render none of it, and silently dropping a resume the user just
     * watched being extracted is the one outcome worth ruling out here.
     */
    const canvas = isBlankTemplate(template.slug) && !importedContent;

    // The profession the user was browsing, if any, decides which sample the
    // resume starts from — the gallery previewed that one, so opening the editor
    // on the template's general sample instead would be a bait and switch.
    // An unknown slug is not an error: it just falls through to the template's.
    const professionSample =
      profession && !canvas && !importedContent
        ? await prisma.profession
            .findUnique({ where: { slug: profession }, select: { sampleContent: true } })
            .then((row) => row?.sampleContent ?? null)
        : null;

    // Seeded templates carry sample content so a new resume opens with something
    // to edit; fall back to a blank document if that sample is ever absent.
    // "Start from Blank" skips the sample entirely for a minimal scaffold.
    const sample = resumeContentSchema.safeParse(professionSample ?? template.sampleContent);
    const content = importedContent
      ? importedContent
      : canvas
        ? createBlankCanvasContent()
        : blank
          ? createBlankContent()
          : sample.success
            ? sample.data
            : createEmptyContent();

    const resume = await prisma.resume.create({
      data: {
        userId: req.userId,
        templateId: template.id,
        title:
          title ??
          (importedContent
            ? "Imported Resume"
            : blank || canvas
              ? "Untitled Resume"
              : `${template.name} Resume`),
        content,
        theme: parseTheme(template.defaultTheme),
      },
      include: { template: true },
    });

    res.status(201).json({ resume: serializeResumeWithTemplate(resume) });
  }),
);

resumesRouter.get(
  "/:id",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const resume = await findOwnedResume(req.params.id!, req.userId);
    res.json({ resume: serializeResumeWithTemplate(resume) });
  }),
);

/** Autosave target. */
resumesRouter.patch(
  "/:id",
  validateBody(updateResumeBodySchema),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { title, content, theme, templateId } = req.body;

    // A templateId from the client is untrusted input that becomes a foreign
    // key, so confirm the template exists before writing it.
    if (templateId !== undefined) {
      const exists = await prisma.template.findUnique({ where: { id: templateId } });
      if (!exists) throw notFound("Template");
    }

    // updateMany so ownership is enforced in the WHERE clause; a plain update by
    // id would let any authenticated user write to any resume.
    const { count } = await prisma.resume.updateMany({
      where: { id: req.params.id!, userId: req.userId },
      data: {
        ...(title !== undefined && { title }),
        ...(content !== undefined && { content }),
        ...(theme !== undefined && { theme }),
        ...(templateId !== undefined && { templateId }),
      },
    });

    if (count === 0) throw notFound("Resume");

    const resume = await findOwnedResume(req.params.id!, req.userId);
    res.json({ resume: serializeResumeWithTemplate(resume) });
  }),
);

resumesRouter.delete(
  "/:id",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { count } = await prisma.resume.deleteMany({
      where: { id: req.params.id!, userId: req.userId },
    });
    if (count === 0) throw notFound("Resume");
    res.status(204).end();
  }),
);

resumesRouter.post(
  "/:id/duplicate",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const source = await findOwnedResume(req.params.id!, req.userId);

    const copy = await prisma.resume.create({
      data: {
        userId: req.userId,
        templateId: source.templateId,
        title: `${source.title} (copy)`,
        content: source.content ?? {},
        theme: source.theme ?? {},
      },
      include: { template: true },
    });

    res.status(201).json({ resume: serializeResumeWithTemplate(copy) });
  }),
);

resumesRouter.get(
  "/:id/export.pdf",
  validateQuery(exportQuerySchema),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const resume = await findOwnedResume(req.params.id!, req.userId);
    const { pageSize } = req.query as { pageSize?: PageSize };

    const theme = parseTheme(resume.theme);
    const content = parseContent(resume.content);

    const pdf = await exportResumePdf({
      templateSlug: resume.template.slug,
      // Images are referenced by URL in the document, but Puppeteer prints from
      // `setContent` — no origin, no cookie — so their bytes have to travel with
      // the markup.
      content: await inlineResumeImages(content, req.userId),
      // The query param lets the editor print Letter without persisting a theme
      // change the user didn't ask for.
      theme: pageSize ? themeSchema.parse({ ...theme, pageSize }) : theme,
    });

    // Named after the person, not the document: a recruiter's downloads folder is
    // full of files called "resume.pdf", and this is the one thing about the export
    // the applicant doesn't get to fix afterwards.
    const filename = getExportFilename({ title: resume.title, content });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", contentDispositionAttachment(filename));
    res.setHeader("Content-Length", pdf.byteLength);
    res.end(Buffer.from(pdf));
  }),
);
