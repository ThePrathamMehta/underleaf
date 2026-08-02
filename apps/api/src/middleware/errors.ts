import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodSchema } from "zod";

/** An error with an intended HTTP status, thrown by route handlers. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound = (what = "Resource") => new HttpError(404, `${what} not found`);
export const badRequest = (message: string) => new HttpError(400, message);
export const unauthorized = (message = "Not authenticated") => new HttpError(401, message);

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
  if (error instanceof ValidationError) {
    res.status(400).json({ error: "Validation failed", details: zodDetails(error.zodError) });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({ error: "Validation failed", details: zodDetails(error) });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }

  console.error("Unhandled error:", error);
  res.status(500).json({ error: "Internal server error" });
}
