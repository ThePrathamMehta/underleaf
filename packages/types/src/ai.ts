import { z } from "zod";
import { planKeySchema } from "./billing";

/**
 * Wire types for the v4 AI layer: which provider and model answer a given kind
 * of request, and who is allowed to change that.
 *
 * The values here are the single source of truth for both ends — `packages/ai`
 * validates against them before it will build a client, and the admin UI renders
 * its pickers from them, so a provider added here shows up in the UI without a
 * second list to keep in step.
 */

// --- Roles ---

export const USER_ROLES = ["user", "admin"] as const;

export const userRoleSchema = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof userRoleSchema>;

// --- Providers and purposes ---

/**
 * `other` is the escape hatch: any gateway speaking the OpenAI chat-completions
 * format, reached at a configured `baseUrl`. That covers most self-hosted and
 * open-source model servers without an adapter per vendor.
 */
export const AI_PROVIDERS = ["openai", "anthropic", "other"] as const;

export const aiProviderSchema = z.enum(AI_PROVIDERS);
export type AiProvider = z.infer<typeof aiProviderSchema>;

/**
 * What a configured model is *for*.
 *
 * `all` is the fallback rather than a wildcard override: a request for `ats`
 * prefers an active `ats` row and falls back to an active `all` row, so a
 * deployment can start with one row for everything and split later without
 * touching any calling code.
 */
export const AI_PURPOSES = ["chat", "ats", "jdMatch", "coverLetter", "all"] as const;

export const aiPurposeSchema = z.enum(AI_PURPOSES);
export type AiPurpose = z.infer<typeof aiPurposeSchema>;

/** The four real purposes, in the order the admin table lists them. */
export const AI_FEATURE_PURPOSES = ["chat", "ats", "jdMatch", "coverLetter"] as const;

/** Human labels, so the API and the admin page can't drift on wording. */
export const AI_PURPOSE_LABELS: Record<AiPurpose, string> = {
  chat: "Chat assistant",
  ats: "ATS scoring",
  jdMatch: "Job-description match",
  coverLetter: "Cover letters",
  all: "Everything else",
};

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  other: "OpenAI-compatible",
};

// --- DTOs ---

/**
 * One configured provider/model as the admin UI sees it.
 *
 * Note what is absent: there is no field here that could hold a key. The client
 * gets the *name* of the environment variable a row points at, and a boolean for
 * whether that variable is actually set on the server. That is enough to render
 * a picker and to warn about a misconfiguration, and it is the whole reason the
 * Definition of Done's "no raw API key reaches the browser" holds by
 * construction rather than by remembering to strip a field.
 */
export const aiProviderConfigSchema = z.object({
  id: z.string(),
  provider: aiProviderSchema,
  modelName: z.string(),
  apiKeySecretRef: z.string(),
  /** Whether that env var is actually set on the server right now. */
  apiKeyConfigured: z.boolean(),
  purpose: aiPurposeSchema,
  /**
   * Which tier this row serves, or null for "any tier" (v5 Section 4).
   *
   * The point is cost: free-tier chat can be routed to a cheaper model than paid
   * chat while the metering above stays identical. Null is not a wildcard
   * override but a *fallback* — an exact `(purpose, plan)` row wins, and a
   * deployment that never sets this behaves exactly as v4 did.
   */
  planKey: planKeySchema.nullable(),
  isActive: z.boolean(),
  baseUrl: z.string().nullable(),
  updatedAt: z.string(),
});

export type AiProviderConfigDto = z.infer<typeof aiProviderConfigSchema>;

/** One selectable key reference: its env var name and whether it's populated. */
export const aiSecretRefSchema = z.object({
  name: z.string(),
  configured: z.boolean(),
});

export type AiSecretRefDto = z.infer<typeof aiSecretRefSchema>;

export const aiConfigResponseSchema = z.object({
  configs: z.array(aiProviderConfigSchema),
  /** Every env var name an admin is permitted to point a config at. */
  availableSecretRefs: z.array(aiSecretRefSchema),
});

export type AiConfigResponse = z.infer<typeof aiConfigResponseSchema>;

// --- Request bodies ---

/**
 * Model names are free text on purpose.
 *
 * Providers ship new models constantly, and an enum here would mean a deploy
 * every time one appeared — exactly the coupling the admin-configurable
 * requirement exists to remove. A wrong name fails at call time with a specific
 * provider error, which is a better failure than being unable to type it.
 */
const modelNameSchema = z.string().min(1).max(120);

/**
 * An env var name, not a key. The pattern rejects anything that isn't
 * shaped like one, and the API separately checks it against an allowlist —
 * without that second check an admin could name any variable in the process
 * environment and read its presence back.
 */
const secretRefSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Z][A-Z0-9_]*$/, "Expected an environment variable name, e.g. ANTHROPIC_API_KEY");

export const upsertAiConfigBodySchema = z
  .object({
    /** Omitted to create, supplied to update an existing row. */
    id: z.string().optional(),
    provider: aiProviderSchema,
    modelName: modelNameSchema,
    apiKeySecretRef: secretRefSchema,
    purpose: aiPurposeSchema,
    planKey: planKeySchema.nullable().optional(),
    isActive: z.boolean().default(true),
    baseUrl: z.string().url().max(300).nullable().optional(),
  })
  .refine((body) => body.provider !== "other" || Boolean(body.baseUrl), {
    // A first-party provider knows its own endpoint; `other` is defined by not
    // having one, so a row without a base URL could never be called.
    message: "An OpenAI-compatible provider needs a base URL",
    path: ["baseUrl"],
  });

export type UpsertAiConfigBody = z.infer<typeof upsertAiConfigBodySchema>;
