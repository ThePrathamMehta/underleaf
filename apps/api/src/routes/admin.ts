import { Router } from "express";
import { prisma } from "@repo/db";
import type { AiProviderConfig } from "@repo/db";
import {
  upsertAiConfigBodySchema,
  type AiConfigResponse,
  type AiProvider,
  type AiProviderConfigDto,
  type AiPurpose,
  type PlanKey,
  type UpsertAiConfigBody,
} from "@repo/types";
import { isAllowedSecretRef, listSecretRefs, resolveSecretRef } from "../config.js";
import { asyncHandler, badRequest, notFound, validateBody } from "../middleware/errors.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

/**
 * Admin-only configuration of which provider and model answer each AI feature.
 *
 * The security property this file is responsible for: a raw API key never
 * crosses this boundary in either direction. Requests carry the *name* of an
 * environment variable, responses carry that name plus whether it's populated,
 * and the only code that turns a name into a value is `resolveSecretRef` — which
 * refuses anything outside the allowlist.
 */
export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

function serializeConfig(row: AiProviderConfig): AiProviderConfigDto {
  return {
    id: row.id,
    provider: row.provider as AiProvider,
    modelName: row.modelName,
    apiKeySecretRef: row.apiKeySecretRef,
    // A boolean, computed here and never stored. This is the only thing the
    // browser learns about the key's contents, and it is bounded by the
    // allowlist: a ref that isn't allowed reports as unconfigured whether or not
    // a variable by that name happens to exist.
    apiKeyConfigured: Boolean(resolveSecretRef(row.apiKeySecretRef)),
    purpose: row.purpose as AiPurpose,
    planKey: (row.planKey as PlanKey | null) ?? null,
    isActive: row.isActive,
    baseUrl: row.baseUrl,
    updatedAt: row.updatedAt.toISOString(),
  };
}

adminRouter.get(
  "/ai-config",
  asyncHandler(async (_req, res) => {
    const rows = await prisma.aiProviderConfig.findMany({ orderBy: { updatedAt: "desc" } });

    const body: AiConfigResponse = {
      configs: rows.map(serializeConfig),
      availableSecretRefs: listSecretRefs(),
    };

    res.json(body);
  }),
);

adminRouter.patch(
  "/ai-config",
  validateBody(upsertAiConfigBodySchema),
  asyncHandler(async (req, res) => {
    const body = req.body as UpsertAiConfigBody;

    // The Zod schema checks that the ref is *shaped* like an env var name. This
    // checks that it is one an admin is permitted to reference at all — the
    // difference between the two is the whole defence against pointing a config
    // at JWT_SECRET.
    if (!isAllowedSecretRef(body.apiKeySecretRef)) {
      throw badRequest(
        `"${body.apiKeySecretRef}" isn't an AI key. Use ANTHROPIC_API_KEY, OPENAI_API_KEY, ` +
          "or a variable named with the AI_KEY_ prefix.",
      );
    }

    const data = {
      provider: body.provider,
      modelName: body.modelName.trim(),
      apiKeySecretRef: body.apiKeySecretRef,
      purpose: body.purpose,
      // Absent and explicitly null mean the same thing here — "serves every
      // tier" — so both normalise to null rather than leaving the column
      // untouched on an update that cleared the field.
      planKey: body.planKey ?? null,
      isActive: body.isActive,
      baseUrl: body.baseUrl ?? null,
    };

    if (body.id) {
      // Checked first so updating a row that has since been deleted 404s rather
      // than failing as an opaque Prisma error.
      const existing = await prisma.aiProviderConfig.findUnique({ where: { id: body.id } });
      if (!existing) throw notFound("AI configuration");

      const updated = await prisma.aiProviderConfig.update({ where: { id: body.id }, data });
      res.json({ config: serializeConfig(updated) });
      return;
    }

    const created = await prisma.aiProviderConfig.create({ data });
    res.status(201).json({ config: serializeConfig(created) });
  }),
);
