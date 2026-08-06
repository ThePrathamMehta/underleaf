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
    const { category, profession } = req.query as { category?: string; profession?: string };

    // Unfiltered by profession: the whole library, alphabetical as before.
    if (!profession) {
      const templates = await prisma.template.findMany({
        where: category ? { category } : undefined,
        orderBy: { name: "asc" },
      });

      res.json({ templates: templates.map(serializeTemplate) });
      return;
    }

    // Filtered by profession: curated rank decides the order, so the strongest
    // recommendation leads the grid. Queried from the join side because rank
    // lives there and Prisma can't order a relation's rows from the parent.
    //
    // An unknown slug yields no rows rather than a 404 — the gallery treats it
    // as "nothing matched" and the profession row itself already 404s on
    // /professions/:slug if it genuinely doesn't exist.
    const picks = await prisma.templateProfession.findMany({
      where: {
        profession: { slug: profession },
        // AND, not OR: category narrows within the profession's list.
        template: category ? { category } : undefined,
      },
      orderBy: { rank: "asc" },
      include: { template: true },
    });

    res.json({ templates: picks.map((pick) => serializeTemplate(pick.template)) });
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
