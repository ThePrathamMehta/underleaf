import { Router } from "express";
import { prisma } from "@repo/db";
import { asyncHandler, notFound } from "../middleware/errors.js";
import { serializeProfession } from "../serializers.js";

export const professionsRouter = Router();

/** Public, like the gallery it feeds — profession is browsable before signing up. */
professionsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const professions = await prisma.profession.findMany({
      // Curated order, not alphabetical: the seed puts the commonest first.
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    res.json({ professions: professions.map(serializeProfession) });
  }),
);

professionsRouter.get(
  "/:slug",
  asyncHandler(async (req, res) => {
    const { slug } = req.params;

    // Id or slug, matching the templates route so either kind of URL resolves.
    const profession = await prisma.profession.findFirst({
      where: { OR: [{ id: slug }, { slug }] },
    });

    if (!profession) throw notFound("Profession");
    res.json({ profession: serializeProfession(profession) });
  }),
);
