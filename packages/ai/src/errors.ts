/**
 * One error type for every provider, with a code the UI can branch on.
 *
 * The Definition of Done asks that a failing AI call never surface as "something
 * went wrong". That is only achievable if the failure survives the trip out of a
 * provider SDK with its meaning intact — a 401 has to still be recognizably a
 * key problem by the time a panel renders it. Hence a closed set of codes, and
 * hence every adapter being required to map into it.
 */

export const AI_ERROR_CODES = [
  /** The request exceeded its deadline, or the caller aborted it. */
  "timeout",
  /** 429, or a provider-specific overloaded signal. Retryable. */
  "rate_limit",
  /** 401/403 — a missing, wrong, or unauthorized key. Never retryable. */
  "auth",
  /** The provider answered, but with an error: 5xx, or a refusal. */
  "provider",
  /** The provider answered fine, but the answer wasn't usable — bad tool JSON. */
  "invalid_response",
  /** No active config for this purpose, or its secret ref resolves to nothing. */
  "not_configured",
] as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

/**
 * Messages users actually see. Written for the person in front of the editor,
 * not the operator reading logs: a rate limit is a "try again", a bad key is
 * "an admin has to fix this", and the difference matters because only one of
 * them is worth the user retrying.
 */
const DEFAULT_MESSAGES: Record<AiErrorCode, string> = {
  timeout: "The model took too long to respond. Try again.",
  rate_limit: "The model is rate limited right now. Wait a moment and try again.",
  auth: "The configured API key was rejected. An admin needs to check the AI settings.",
  provider: "The model provider returned an error.",
  invalid_response: "The model returned something we couldn't use.",
  not_configured: "No AI model is configured for this feature yet.",
};

/** Which failures are worth one more attempt. Anything else fails immediately. */
const RETRYABLE = new Set<AiErrorCode>(["rate_limit", "provider", "timeout"]);

export class AiError extends Error {
  readonly code: AiErrorCode;
  /** HTTP status from the provider, when there was one. */
  readonly status?: number;
  /** True when `client.ts` should spend its single retry on this. */
  readonly retryable: boolean;

  constructor(
    code: AiErrorCode,
    message?: string,
    options: { status?: number; cause?: unknown; retryable?: boolean } = {},
  ) {
    super(message ?? DEFAULT_MESSAGES[code], { cause: options.cause });
    this.name = "AiError";
    this.code = code;
    this.status = options.status;
    this.retryable = options.retryable ?? RETRYABLE.has(code);
  }

  /** The user-facing half, safe to send to a browser. */
  toPublic(): { code: AiErrorCode; message: string } {
    return { code: this.code, message: this.message };
  }
}

/**
 * Maps an HTTP status to a code, the one piece of error classification both
 * providers share. Adapters call this after they've had a chance to recognize
 * anything vendor-specific, so their own signals win.
 */
export function codeForStatus(status: number | undefined): AiErrorCode {
  if (status === undefined) return "provider";
  if (status === 401 || status === 403) return "auth";
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "rate_limit";
  return "provider";
}

/**
 * Last resort for a value that reached a catch block. Anything already an
 * `AiError` passes through unchanged, so adapters can classify precisely and
 * still funnel everything through one call.
 */
export function toAiError(error: unknown, fallback: AiErrorCode = "provider"): AiError {
  if (error instanceof AiError) return error;

  // An aborted fetch is a timeout from the caller's point of view, whether the
  // deadline fired or the user navigated away — either way the answer isn't
  // coming, and neither case is a provider fault worth reporting as one.
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return new AiError("timeout", undefined, { cause: error });
  }

  const message = error instanceof Error ? error.message : String(error);
  return new AiError(fallback, message || undefined, { cause: error });
}
