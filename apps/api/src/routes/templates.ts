import { Router } from "express";
import { prisma } from "@repo/db";
import { templateListQuerySchema } from "@repo/types";
import { asyncHandler, notFound, validateQuery } from "../middleware/errors.js";
import { serializeTemplate } from "../serializers.js";

export const templatesRouter = Router();

/** Public: the gallery is browsable before signing up. */
templatesRouter.get(
  "/",
  validateQuery(templateListQuerySchema),
  asyncHandler(async (req, res) => {
    const { category } = req.query as { category?: string };

    const templates = await prisma.template.findMany({
      where: category ? { category } : undefined,
      orderBy: { name: "asc" },
    });

    res.json({ templates: templates.map(serializeTemplate) });
  }),
);

templatesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Accept either an id or a slug, so gallery URLs can stay readable.
    const template = await prisma.template.findFirst({
      where: { OR: [{ id }, { slug: id }] },
    });

    if (!template) throw notFound("Template");
    res.json({ template: serializeTemplate(template) });
  }),
);
