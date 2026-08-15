import type { NextFunction, Request, Response } from "express";
import { MulterError } from "multer";
import { ZodError, type ZodSchema } from "zod";
import { config } from "../config.js";

/** A byte count as the megabytes a user recognises: `15728640` → `15MB`. */
export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10}MB`;
}

/**
 * An error with an intended HTTP status, thrown by route handlers.
 *
 * `body` merges extra fields into the JSON response alongside `error`. Only one
 * thing needs it — a blocked metered request answers with a machine-readable
 * `code` and the current allowance so the panel can render "0 of 10 left" inline
 * rather than parsing the sentence — and a third constructor argument is a
 * smaller change than a second error class the middleware has to know about.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound = (what = "Resource") => new HttpError(404, `${what} not found`);
export const badRequest = (message: string) => new HttpError(400, message);
export const unauthorized = (message = "Not authenticated") => new HttpError(401, message);
export const forbidden = (message = "Not allowed") => new HttpError(403, message);

/** Wraps an async handler so a rejected promise reaches the error middleware. */
export function asyncHandler<T extends Request>(
  handler: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req as T, res, next).catch(next);
  };
}

function zodDetails(error: ZodError) {
  return error.errors.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

/**
 * Validates and *replaces* req.body with the parsed result, so handlers work
 * with typed, stripped data rather than raw input.
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(new ValidationError(result.error));
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(new ValidationError(result.error));
      return;
    }
    // Express types req.query narrowly; the parsed value is what handlers want.
    req.query = result.data as Request["query"];
    next();
  };
}

export class ValidationError extends Error {
  constructor(readonly zodError: ZodError) {
    super("Validation failed");
    this.name = "ValidationError";
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express identifies error middleware by arity
export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  // A streaming response has already committed its status and content type, so
  // there is no JSON body left to send — writing one throws "cannot set headers
  // after they are sent" and masks the original fault. Ending the connection is
  // what the client's stream reader already knows how to handle.
  if (res.headersSent) {
    console.error("Error after the response had started:", error);
    res.end();
    return;
  }

  if (error instanceof ValidationError) {
    res.status(400).json({ error: "Validation failed", details: zodDetails(error.zodError) });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({ error: "Validation failed", details: zodDetails(error) });
    return;
  }

  if (error instanceof MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      // Derived, not written out: the limit is env-driven, so a hardcoded "15MB"
      // here would quietly lie to the user the first time it was raised.
      res.status(413).json({
        error: `That file is too large. The most Underleaf accepts is ${formatBytes(config.maxUploadBytes)}.`,
      });
      return;
    }
    if (error.code === "LIMIT_UNEXPECTED_FILE") {
      res.status(400).json({ error: "Unexpected file field" });
      return;
    }
    res.status(400).json({ error: `Upload failed: ${error.message}` });
    return;
  }

  if (error instanceof HttpError) {
    // `error` last so a stray `error` key in `body` can't replace the message.
    res.status(error.status).json({ ...error.body, error: error.message });
    return;
  }

  console.error("Unhandled error:", error);
  res.status(500).json({ error: "Internal server error" });
}
