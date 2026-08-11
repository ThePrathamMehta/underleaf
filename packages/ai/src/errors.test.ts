import { describe, expect, test } from "bun:test";
import { AI_ERROR_CODES, AiError, codeForStatus, toAiError } from "./errors";

/**
 * These cover the promise the Definition of Done makes — that a provider
 * failure reaches the user as a specific, actionable message rather than
 * "something went wrong" — and the retry policy that hangs off the same codes.
 */

describe("codeForStatus", () => {
  test("separates the statuses a user can act on from the ones they can't", () => {
    expect(codeForStatus(401)).toBe("auth");
    expect(codeForStatus(403)).toBe("auth");
    expect(codeForStatus(429)).toBe("rate_limit");
    expect(codeForStatus(408)).toBe("timeout");
    expect(codeForStatus(504)).toBe("timeout");
  });

  test("falls back to provider for anything unrecognized", () => {
    expect(codeForStatus(500)).toBe("provider");
    expect(codeForStatus(418)).toBe("provider");
    expect(codeForStatus(undefined)).toBe("provider");
  });
});

describe("AiError", () => {
  test("carries a real default message for every code", () => {
    for (const code of AI_ERROR_CODES) {
      const error = new AiError(code);
      expect(error.message.length).toBeGreaterThan(0);
      // A default that is just the code would defeat the whole point.
      expect(error.message).not.toBe(code);
    }
  });

  test("an explicit message wins over the default", () => {
    const error = new AiError("invalid_response", "The model returned an empty letter.");
    expect(error.message).toBe("The model returned an empty letter.");
  });

  // Spending a retry on a bad key just delays the same failure; not spending
  // one on a rate limit turns a blip into an outage for the user.
  test("retries transient failures and only those", () => {
    expect(new AiError("rate_limit").retryable).toBe(true);
    expect(new AiError("provider").retryable).toBe(true);
    expect(new AiError("timeout").retryable).toBe(true);

    expect(new AiError("auth").retryable).toBe(false);
    expect(new AiError("invalid_response").retryable).toBe(false);
    expect(new AiError("not_configured").retryable).toBe(false);
  });

  test("an explicit retryable overrides the code's default", () => {
    expect(new AiError("auth", undefined, { retryable: true }).retryable).toBe(true);
    expect(new AiError("rate_limit", undefined, { retryable: false }).retryable).toBe(false);
  });

  test("toPublic exposes the code and message and nothing else", () => {
    const error = new AiError("auth", "Rejected.", {
      status: 401,
      cause: new Error("raw sdk detail"),
    });
    expect(error.toPublic()).toEqual({ code: "auth", message: "Rejected." });
    // The cause and status stay server-side: one is an SDK internal, the other
    // is a detail the browser has no use for.
    expect(Object.keys(error.toPublic()).sort()).toEqual(["code", "message"]);
  });

  test("is catchable as an Error", () => {
    const error = new AiError("provider");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AiError");
  });
});

describe("toAiError", () => {
  test("passes an AiError through untouched, so adapter classification wins", () => {
    const original = new AiError("auth", "Key rejected.", { status: 401 });
    const mapped = toAiError(original);
    expect(mapped).toBe(original);
    expect(mapped.code).toBe("auth");
  });

  test("reads an abort as a timeout rather than a provider fault", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(toAiError(abort).code).toBe("timeout");

    const deadline = new Error("timed out");
    deadline.name = "TimeoutError";
    expect(toAiError(deadline).code).toBe("timeout");
  });

  test("uses the given fallback for an unrecognized failure", () => {
    expect(toAiError(new Error("weird"), "invalid_response").code).toBe("invalid_response");
    expect(toAiError(new Error("weird")).code).toBe("provider");
  });

  test("keeps the original as the cause for logging", () => {
    const cause = new Error("socket hang up");
    expect(toAiError(cause).cause).toBe(cause);
  });

  test("survives a thrown non-Error", () => {
    expect(toAiError("just a string").message).toBe("just a string");
    expect(toAiError(null).code).toBe("provider");
    // An empty message would render as a blank error in a panel, so the code's
    // default has to take over.
    expect(toAiError("").message.length).toBeGreaterThan(0);
  });
});
