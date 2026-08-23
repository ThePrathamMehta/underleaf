import type { NextFunction, Request, Response } from "express";
import { tooManyRequests } from "./errors.js";
import type { AuthedRequest } from "./auth.js";

/**
 * A per-user sliding-window rate limit.
 *
 * This exists for one specific job: LaTeX import is free on every plan — it's a
 * one-time act per resume, not the recurring generation v5's allowance meters —
 * and its AI fallback is therefore the one model call in the app that nothing
 * charges for. Something has to stand between that and a script, and a limit on
 * attempts is the honest instrument: it costs a real user nothing and costs an
 * abuser everything.
 *
 * Deliberately in memory, and deliberately not a table. A counter that resets on
 * deploy is the right trade for a guard whose worst case is a handful of extra
 * calls from one account in one hour; a durable one would mean a migration, a
 * write on every request, and a row per user to prune. The consequence to know
 * about is that the limit is per process — behind N instances the effective
 * ceiling is N times `max`, which for a bound whose purpose is to stop automation
 * rather than to price a feature is still comfortably inside its intent.
 *
 * Every call already lands in `AiUsageLog`, so real abuse is visible even where
 * this doesn't stop it.
 */

/** Timestamps of a user's recent hits, newest last. */
type Window = number[];

/**
 * How many idle users to hold before sweeping.
 *
 * Without this the map is a slow leak: one key per user who ever imported,
 * held for the life of the process. The sweep is amortised onto the request that
 * crosses the threshold rather than run on a timer, which keeps the middleware
 * free of anything that has to be torn down in tests.
 */
const SWEEP_AFTER_KEYS = 5_000;

export interface RateLimitOptions {
  /** How many requests one user may make inside the window. */
  max: number;
  windowMs: number;
  /**
   * The message a blocked caller sees. Takes the whole-minute wait, so the copy
   * can say when to come back rather than quoting a policy.
   */
  message: (retryAfterMinutes: number) => string;
}

/**
 * Builds the middleware. One limiter per call, so two routes sharing a limit
 * share one instance and two routes with different limits can't interfere.
 *
 * Must be mounted after `requireAuth`: the key is the user id, because keying on
 * IP would let one office share a limit and one user with a proxy dodge it.
 */
export function rateLimit(options: RateLimitOptions) {
  const hits = new Map<string, Window>();

  function sweep(now: number) {
    for (const [key, window] of hits) {
      const last = window[window.length - 1];
      if (last === undefined || now - last >= options.windowMs) hits.delete(key);
    }
  }

  return (req: Request, _res: Response, next: NextFunction) => {
    // Typed as a plain `Request` so Express accepts it in a handler chain, and
    // narrowed here — the same shape every other post-auth middleware uses.
    const { userId } = req as AuthedRequest;
    const now = Date.now();
    if (hits.size > SWEEP_AFTER_KEYS) sweep(now);

    const since = now - options.windowMs;
    const window = (hits.get(userId) ?? []).filter((at) => at > since);

    if (window.length >= options.max) {
      // The oldest hit in the window is the one that has to expire before there
      // is room again, so that — not the whole window — is the wait.
      const waitMs = window[0]! + options.windowMs - now;
      const minutes = Math.max(1, Math.ceil(waitMs / 60_000));
      hits.set(userId, window);
      next(tooManyRequests(options.message(minutes), Math.ceil(waitMs / 1000)));
      return;
    }

    window.push(now);
    hits.set(userId, window);
    next();
  };
}
