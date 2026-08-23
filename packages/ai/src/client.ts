import type { AiPurpose } from "@repo/types";
import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { AiError, toAiError } from "./errors";
import type {
  AiAdapter,
  AiCompletion,
  AiRequest,
  AiStreamEvent,
  AiToolCall,
  AiToolDef,
} from "./types";

/**
 * The guardrails, applied once for every provider.
 *
 * Adapters translate wire formats and nothing else. Everything about *how hard
 * we try* — the deadline, the token ceiling, the one retry — lives here, because
 * a policy implemented per adapter is a policy that differs per adapter.
 */

// --- Per-purpose limits ---

/**
 * Deadlines and token ceilings by feature.
 *
 * These differ because the work differs, not to be conservative for its own
 * sake. A chat turn that rewrites three sections legitimately needs both room
 * and time; an ATS scoring pass is a bounded judgement over a document we
 * already have and should fail fast rather than leave a spinner up. The cover
 * letter is the one case where the output *is* the deliverable, so it gets the
 * most tokens.
 *
 * The LaTeX import is the largest single output of the lot: it returns a whole
 * resume document as JSON, which is why its ceiling is the highest here. Its
 * deadline is generous for the same reason — a user who has just pasted a CV is
 * watching one progress indicator and will wait, whereas an ATS spinner sitting
 * beside a document they can already read will not be forgiven.
 */
const PURPOSE_LIMITS: Record<AiPurpose, { maxTokens: number; timeoutMs: number }> = {
  chat: { maxTokens: 4096, timeoutMs: 120_000 },
  ats: { maxTokens: 2048, timeoutMs: 60_000 },
  jdMatch: { maxTokens: 2048, timeoutMs: 60_000 },
  coverLetter: { maxTokens: 3072, timeoutMs: 90_000 },
  latexImport: { maxTokens: 8192, timeoutMs: 120_000 },
  all: { maxTokens: 4096, timeoutMs: 90_000 },
};

export function limitsFor(purpose: AiPurpose): { maxTokens: number; timeoutMs: number } {
  return PURPOSE_LIMITS[purpose] ?? PURPOSE_LIMITS.all;
}

/**
 * Fills in whatever the caller left unset, so an adapter never has to decide.
 *
 * The caller's own `signal` is respected alongside the deadline: `AbortSignal.any`
 * means a user closing the chat panel cancels the request immediately instead of
 * waiting out the timeout.
 */
function applyLimits(request: AiRequest, purpose: AiPurpose): AiRequest {
  const limits = limitsFor(purpose);
  const timeoutMs = request.timeoutMs ?? limits.timeoutMs;
  const deadline = AbortSignal.timeout(timeoutMs);

  return {
    ...request,
    maxTokens: request.maxTokens ?? limits.maxTokens,
    timeoutMs,
    signal: request.signal ? AbortSignal.any([request.signal, deadline]) : deadline,
  };
}

// --- Retry ---

/** One retry. Not two: a second is rarely the difference, and a user is waiting. */
const MAX_ATTEMPTS = 2;

/**
 * Backoff before the retry. Short, because this sits in front of a user watching
 * a panel — long enough to clear a momentary 429, not long enough to feel hung.
 */
const RETRY_DELAY_MS = 750;

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new AiError("timeout"));
      },
      { once: true },
    );
  });
}

// --- Completions ---

/**
 * A single non-streaming call, with the deadline and one retry applied.
 *
 * The retry is deliberately *not* applied to anything the provider already
 * answered — a 400 or an auth failure means trying again produces the same
 * result more slowly, which is exactly the "silent hang" the Definition of Done
 * rules out.
 */
export async function getCompletion(
  adapter: AiAdapter,
  request: AiRequest,
  purpose: AiPurpose,
): Promise<AiCompletion> {
  let lastError: AiError | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Rebuilt per attempt: a fresh deadline, since a signal that already fired
    // would abort the retry before it left the process.
    const prepared = applyLimits(request, purpose);

    try {
      return await adapter.complete(prepared);
    } catch (error) {
      lastError = toAiError(error);
      if (!lastError.retryable || attempt === MAX_ATTEMPTS) throw lastError;
      // The caller's own signal, not the deadline's — waiting out a backoff for
      // a request the user already cancelled helps nobody.
      await delay(RETRY_DELAY_MS, request.signal);
    }
  }

  throw lastError ?? new AiError("provider");
}

/**
 * A streamed call.
 *
 * Retries only while nothing has been emitted. Once a token has reached the
 * client, restarting would replay half a sentence into the middle of the
 * assistant's turn — worse than the error the user would otherwise see, and not
 * something a panel could unwind.
 */
export async function* streamCompletion(
  adapter: AiAdapter,
  request: AiRequest,
  purpose: AiPurpose,
): AsyncIterable<AiStreamEvent> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const prepared = applyLimits(request, purpose);
    let emitted = false;
    let failure: AiError | undefined;

    for await (const event of adapter.stream(prepared)) {
      if (event.type === "error") {
        failure = new AiError(event.code, event.message);
        break;
      }
      emitted = true;
      yield event;
    }

    if (!failure) return;

    const shouldRetry = failure.retryable && !emitted && attempt < MAX_ATTEMPTS;
    if (!shouldRetry) {
      yield { type: "error", code: failure.code, message: failure.message };
      return;
    }

    await delay(RETRY_DELAY_MS, request.signal);
  }
}

// --- Tool calling ---

/**
 * Derives a tool definition from a Zod schema.
 *
 * This is the mechanism behind "every AI edit is validated before it is
 * applied". The JSON Schema the model is shown and the schema its arguments are
 * checked against are the same object, so a tool whose description drifts from
 * its validation is not expressible. `$refStrategy: "none"` inlines everything,
 * because both providers reject `$ref` pointing outside the schema they were
 * given.
 */
export function toolFromZod(
  name: string,
  description: string,
  schema: z.ZodType<unknown>,
): AiToolDef {
  const jsonSchema = zodToJsonSchema(schema as z.ZodSchema<unknown>, {
    $refStrategy: "none",
    target: "jsonSchema7",
  });

  const parameters = { ...(jsonSchema as Record<string, unknown>) };

  // `$schema` is metadata about the document, not about the tool's arguments.
  // Anthropic rejects a tool schema carrying it.
  delete parameters.$schema;

  return { name, description, parameters };
}

/**
 * Parses and validates one tool call's arguments.
 *
 * Returns a result rather than throwing, because a bad tool call is an ordinary
 * outcome the loop has to report *back to the model* so it can correct itself —
 * not an exception that ends the turn.
 */
export function parseToolCall<T>(
  call: AiToolCall,
  schema: z.ZodType<T>,
): { ok: true; value: T } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(call.arguments);
  } catch {
    return { ok: false, error: `Arguments for ${call.name} were not valid JSON.` };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { ok: false, error: `Arguments for ${call.name} were invalid — ${detail}` };
  }

  return { ok: true, value: parsed.data };
}

/**
 * How many assistant turns one request may take before we stop.
 *
 * A model that keeps calling tools without concluding is a real failure mode,
 * and an unbounded loop spends the user's money discovering it.
 */
const MAX_TOOL_ROUNDS = 8;

export type ToolHandler = (call: AiToolCall) => Promise<{ content: string; isError?: boolean }>;

/**
 * Runs the tool-calling loop to completion and returns the final text.
 *
 * Non-streaming, for the features whose output is a finished artifact — ATS
 * scoring, JD matching, cover letters. The chat assistant drives its own loop on
 * top of `streamCompletion`, because there the point is that the user watches it
 * happen.
 */
export async function callWithTools(
  adapter: AiAdapter,
  request: AiRequest,
  purpose: AiPurpose,
  handler: ToolHandler,
): Promise<AiCompletion> {
  const messages = [...request.messages];
  let promptTokens = 0;
  let outputTokens = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const completion = await getCompletion(adapter, { ...request, messages }, purpose);
    promptTokens += completion.usage.promptTokens;
    outputTokens += completion.usage.outputTokens;

    if (completion.toolCalls.length === 0) {
      // Token counts are summed across rounds so the usage log records what the
      // request actually cost, not what its last round cost.
      return { ...completion, usage: { promptTokens, outputTokens } };
    }

    messages.push({
      role: "assistant",
      content: completion.text,
      toolCalls: completion.toolCalls,
    });

    const toolResults = await Promise.all(
      completion.toolCalls.map(async (call) => {
        const result = await handler(call);
        return { toolCallId: call.id, content: result.content, isError: result.isError };
      }),
    );

    messages.push({ role: "user", content: "", toolResults });
  }

  throw new AiError(
    "invalid_response",
    "The model kept calling tools without finishing. Try rephrasing the request.",
  );
}
