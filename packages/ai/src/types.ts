import type { AiProvider, AiPurpose, PlanKey } from "@repo/types";
import type { AiErrorCode } from "./errors";

/**
 * The vendor-neutral shapes every adapter speaks.
 *
 * Nothing above this layer — not the chat route, not ATS scoring, not the cover
 * letter generator — should ever import a provider SDK type. That is the whole
 * point: swapping the model behind a purpose is an admin flipping a row, and
 * that only stays true if the difference between providers dies inside
 * `src/adapters/`.
 */

// --- Messages ---

export type AiRole = "user" | "assistant";

/**
 * A tool result being handed back to the model.
 *
 * Carried on a `user` message because that is how both providers model it: the
 * assistant asks, the caller answers. `isError` is separate from the content so
 * an adapter can mark the block as an error in the provider's own way rather
 * than us hoping the model infers it from prose.
 */
export type AiToolResult = {
  toolCallId: string;
  /** Already-serialized result. Objects are stringified by the caller. */
  content: string;
  isError?: boolean;
};

export type AiMessage = {
  role: AiRole;
  /** Empty string is legal on an assistant turn that was purely tool calls. */
  content: string;
  /** Tool calls this assistant turn made, in the order the model emitted them. */
  toolCalls?: AiToolCall[];
  /** Results being returned on a user turn, answering the previous assistant turn. */
  toolResults?: AiToolResult[];
};

// --- Tools ---

/**
 * `parameters` is a JSON Schema object. Callers are expected to derive it from a
 * Zod schema with `toolFromZod` rather than hand-writing one, so the schema the
 * model is shown and the schema its arguments are validated against cannot drift.
 */
export type AiToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type AiToolCall = {
  /** Provider-assigned id. Echoed back on the matching `AiToolResult`. */
  id: string;
  name: string;
  /**
   * Raw JSON text as the model produced it, not a parsed object.
   *
   * Models emit malformed JSON often enough that parsing must be the caller's
   * explicit, failable step — an adapter that parsed here would have to invent a
   * value or throw from inside a stream, and both are worse than handing back
   * exactly what arrived.
   */
  arguments: string;
};

// --- Streaming ---

export type AiUsage = {
  promptTokens: number;
  outputTokens: number;
};

/**
 * Why the model stopped. Normalized because the two providers disagree on
 * spelling (`end_turn` vs `stop`, `max_tokens` vs `length`) and the chat loop
 * genuinely branches on `tool_calls`.
 */
export type AiStopReason = "end_turn" | "tool_calls" | "max_tokens" | "other";

/**
 * The normalized stream.
 *
 * `tool_call` arrives complete — adapters buffer partial argument JSON until the
 * block closes rather than emitting fragments. Callers can't do anything useful
 * with half a JSON object, and every consumer would otherwise reimplement the
 * same accumulator.
 */
export type AiStreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; toolCall: AiToolCall }
  | { type: "usage"; usage: AiUsage }
  | { type: "done"; stopReason: AiStopReason }
  | { type: "error"; code: AiErrorCode; message: string };

// --- Requests ---

export type AiRequest = {
  messages: AiMessage[];
  /** Provider-agnostic system prompt. Adapters place it where the API wants it. */
  system?: string;
  tools?: AiToolDef[];
  maxTokens?: number;
  temperature?: number;
  /** Overrides the per-purpose default in `client.ts`. */
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type AiCompletion = {
  text: string;
  toolCalls: AiToolCall[];
  usage: AiUsage;
  stopReason: AiStopReason;
};

// --- Adapters ---

/**
 * What every provider integration must provide, and all it must provide.
 *
 * Deliberately two methods, not one: a non-streaming call is not "a stream we
 * collect" for every provider, and pretending otherwise would push retry and
 * timeout handling into places that can't do it cleanly. `client.ts` wraps both.
 */
export type AiAdapter = {
  provider: AiProvider;
  modelName: string;
  complete(request: AiRequest): Promise<AiCompletion>;
  stream(request: AiRequest): AsyncIterable<AiStreamEvent>;
};

/** Everything needed to build an adapter, resolved from an `AiProviderConfig` row. */
export type AiAdapterConfig = {
  provider: AiProvider;
  modelName: string;
  /** The resolved secret. Comes from the environment, never from the database. */
  apiKey: string;
  baseUrl?: string | null;
};

/** Identifies a call for the usage log. Never carries prompt or completion text. */
export type AiCallContext = {
  purpose: AiPurpose;
  /** Null for a call made outside any user's session. */
  userId?: string | null;
  /**
   * The caller's membership tier, used to pick the model (v5 Section 4).
   *
   * Omitted or null resolves plan-agnostically, which is what every pre-v5
   * caller did and still does. This never affects *whether* a call is allowed —
   * that decision belongs to `checkAndConsumeAiAction` in the API, before the
   * request reaches this layer at all.
   */
  planKey?: PlanKey | null;
};
