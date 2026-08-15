import { prisma } from "@repo/db";
import type { AiProvider, AiPurpose, PlanKey } from "@repo/types";
import { createAnthropicAdapter } from "./adapters/anthropic";
import { createOpenAiAdapter } from "./adapters/openai";
import { createOpenAiCompatibleProviderAdapter } from "./adapters/openai-compatible";
import { callWithTools, getCompletion, streamCompletion, type ToolHandler } from "./client";
import { AiError, toAiError } from "./errors";
import { resolveSecretRef } from "./secrets";
import type {
  AiAdapter,
  AiAdapterConfig,
  AiCallContext,
  AiCompletion,
  AiRequest,
  AiStreamEvent,
} from "./types";

/**
 * Turns a stored configuration row into a live adapter, and records what the
 * call cost.
 *
 * Read per request rather than cached at boot. The Definition of Done asks that
 * changing the model take effect without a redeploy, and a cache would mean
 * "without a redeploy, eventually". One indexed query against a table with a
 * handful of rows is not the thing to optimize here.
 */

function buildAdapter(provider: AiProvider, config: AiAdapterConfig): AiAdapter {
  switch (provider) {
    case "anthropic":
      return createAnthropicAdapter(config);
    case "openai":
      return createOpenAiAdapter(config);
    case "other":
      return createOpenAiCompatibleProviderAdapter(config);
    default:
      throw new AiError("not_configured", `Unknown provider "${String(provider)}".`);
  }
}

export type ResolvedModel = {
  adapter: AiAdapter;
  provider: AiProvider;
  modelName: string;
  /** The purpose actually matched — `all` when the fallback row was used. */
  matchedPurpose: AiPurpose;
  /** The plan actually matched — null when a plan-agnostic row was used. */
  matchedPlanKey: PlanKey | null;
};

/**
 * Finds the active model for a purpose, and for the caller's plan.
 *
 * Two fallback axes, resolved in priority order: an exact `(purpose, plan)` row
 * beats a `(purpose, any-plan)` row, which beats `(all, plan)`, which beats
 * `(all, any-plan)`. A deployment that never sets `planKey` therefore behaves
 * exactly as v4 did — the plan axis only starts mattering once an admin opts
 * into it by creating a plan-specific row.
 *
 * The point is cost, not capability: v5 Section 4 wants free-tier chat routed to
 * a cheaper model than paid-tier chat, while the metering logic above stays
 * identical for both. Within a tier the most recently updated active row wins,
 * which keeps "switch the model" a single write with no window where nothing is
 * active.
 */
export async function resolveModel(
  purpose: AiPurpose,
  planKey?: PlanKey | null,
): Promise<ResolvedModel> {
  const rows = await prisma.aiProviderConfig.findMany({
    where: {
      isActive: true,
      purpose: { in: [purpose, "all"] },
      // A row for another plan is not a candidate at all; null means "any plan"
      // and always is one. Expressed as an OR rather than `in: [planKey, null]`
      // because SQL's IN never matches NULL — and Prisma's filter types say so.
      ...(planKey ? { OR: [{ planKey }, { planKey: null }] } : { planKey: null }),
    },
    orderBy: { updatedAt: "desc" },
  });

  // Ranked rather than filtered four times: `findMany` already returned every
  // candidate newest-first, so the best match is the one with the lowest rank,
  // and ties fall to the more recently updated row for free.
  const rank = (candidate: { purpose: string; planKey: string | null }): number =>
    (candidate.purpose === purpose ? 0 : 2) + (candidate.planKey ? 0 : 1);

  const row = rows.reduce<(typeof rows)[number] | undefined>(
    (best, candidate) => (!best || rank(candidate) < rank(best) ? candidate : best),
    undefined,
  );

  if (!row) {
    throw new AiError(
      "not_configured",
      "No AI model is configured for this feature. An admin can set one in AI settings.",
    );
  }

  const apiKey = resolveSecretRef(row.apiKeySecretRef);
  if (!apiKey) {
    // Names the variable but never its value — this message reaches an admin who
    // needs to know which one to set, and telling them that is not a leak.
    throw new AiError(
      "not_configured",
      `The configured key "${row.apiKeySecretRef}" is not set on the server.`,
    );
  }

  const provider = row.provider as AiProvider;

  return {
    adapter: buildAdapter(provider, {
      provider,
      modelName: row.modelName,
      apiKey,
      baseUrl: row.baseUrl,
    }),
    provider,
    modelName: row.modelName,
    matchedPurpose: row.purpose as AiPurpose,
    matchedPlanKey: (row.planKey as PlanKey | null) ?? null,
  };
}

/**
 * Writes one usage row.
 *
 * Metadata only — provider, model, purpose, counts, latency, and an error code.
 * No prompt, no completion, no resume content. Best-effort by design: a logging
 * failure must not turn a successful completion into an error the user sees,
 * and the row is worth less than the answer it describes.
 */
async function recordUsage(entry: {
  context: AiCallContext;
  provider: AiProvider;
  modelName: string;
  promptTokens: number;
  outputTokens: number;
  latencyMs: number;
  errorCode?: string | null;
}): Promise<void> {
  try {
    await prisma.aiUsageLog.create({
      data: {
        userId: entry.context.userId ?? null,
        provider: entry.provider,
        modelName: entry.modelName,
        purpose: entry.context.purpose,
        promptTokens: entry.promptTokens,
        outputTokens: entry.outputTokens,
        latencyMs: entry.latencyMs,
        errorCode: entry.errorCode ?? null,
      },
    });
  } catch (error) {
    console.error("Failed to write AI usage log:", error);
  }
}

/** A completion for a purpose: resolve the model, call it, log what it cost. */
export async function complete(
  context: AiCallContext,
  request: AiRequest,
): Promise<AiCompletion> {
  const started = Date.now();
  const model = await resolveModel(context.purpose, context.planKey);

  try {
    const completion = await getCompletion(model.adapter, request, context.purpose);
    await recordUsage({
      context,
      provider: model.provider,
      modelName: model.modelName,
      promptTokens: completion.usage.promptTokens,
      outputTokens: completion.usage.outputTokens,
      latencyMs: Date.now() - started,
    });
    return completion;
  } catch (error) {
    const aiError = toAiError(error);
    await recordUsage({
      context,
      provider: model.provider,
      modelName: model.modelName,
      promptTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - started,
      errorCode: aiError.code,
    });
    throw aiError;
  }
}

/** The same, for the tool-calling loop. */
export async function completeWithTools(
  context: AiCallContext,
  request: AiRequest,
  handler: ToolHandler,
): Promise<AiCompletion> {
  const started = Date.now();
  const model = await resolveModel(context.purpose, context.planKey);

  try {
    const completion = await callWithTools(model.adapter, request, context.purpose, handler);
    await recordUsage({
      context,
      provider: model.provider,
      modelName: model.modelName,
      promptTokens: completion.usage.promptTokens,
      outputTokens: completion.usage.outputTokens,
      latencyMs: Date.now() - started,
    });
    return completion;
  } catch (error) {
    const aiError = toAiError(error);
    await recordUsage({
      context,
      provider: model.provider,
      modelName: model.modelName,
      promptTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - started,
      errorCode: aiError.code,
    });
    throw aiError;
  }
}

/**
 * Streaming, for the chat assistant.
 *
 * Usage is logged from the events rather than a return value, since a stream has
 * none — and the `error` event is logged too, so a provider failing mid-turn is
 * as visible in the usage table as one that never started.
 */
export async function* stream(
  context: AiCallContext,
  request: AiRequest,
): AsyncIterable<AiStreamEvent> {
  const started = Date.now();

  let model: ResolvedModel;
  try {
    model = await resolveModel(context.purpose, context.planKey);
  } catch (error) {
    // Resolution failures are yielded rather than thrown so a caller piping this
    // straight to an SSE response has one shape to handle, not two.
    const aiError = toAiError(error, "not_configured");
    yield { type: "error", code: aiError.code, message: aiError.message };
    return;
  }

  let promptTokens = 0;
  let outputTokens = 0;
  let errorCode: string | null = null;

  try {
    for await (const event of streamCompletion(model.adapter, request, context.purpose)) {
      if (event.type === "usage") {
        promptTokens = event.usage.promptTokens;
        outputTokens = event.usage.outputTokens;
      } else if (event.type === "error") {
        errorCode = event.code;
      }
      yield event;
    }
  } finally {
    await recordUsage({
      context,
      provider: model.provider,
      modelName: model.modelName,
      promptTokens,
      outputTokens,
      latencyMs: Date.now() - started,
      errorCode,
    });
  }
}
