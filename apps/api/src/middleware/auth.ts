import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "@repo/db";
import { config } from "../config.js";
import { forbidden, unauthorized } from "./errors.js";

export type AuthedRequest = Request & { userId: string };

type TokenPayload = { sub: string };

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId } satisfies TokenPayload, config.jwtSecret, {
    expiresIn: config.tokenTtlSeconds,
  });
}

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    // Lax rather than Strict so returning from an external link keeps the
    // session; the API is same-site with the web app in this setup.
    sameSite: "lax",
    secure: config.isProduction,
    maxAge: config.tokenTtlMs,
    path: "/",
  });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(config.cookieName, { path: "/" });
}

function readToken(req: Request): string | undefined {
  const fromCookie = req.cookies?.[config.cookieName];
  if (typeof fromCookie === "string" && fromCookie.length > 0) return fromCookie;

  // Bearer fallback exists for the smoke script and curl, which have no jar.
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length);

  return undefined;
}

/** Rejects the request unless a valid token is present, attaching `userId`. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = readToken(req);
  if (!token) {
    next(unauthorized());
    return;
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret) as TokenPayload;
    (req as AuthedRequest).userId = payload.sub;
    next();
  } catch {
    next(unauthorized("Invalid or expired session"));
  }
}

/** Resolves the user id without failing, for endpoints valid either way. */
export function optionalAuth(req: Request): string | undefined {
  const token = readToken(req);
  if (!token) return undefined;
  try {
    return (jwt.verify(token, config.jwtSecret) as TokenPayload).sub;
  } catch {
    return undefined;
  }
}

/**
 * Rejects the request unless the authenticated user is an admin.
 *
 * The role is read from the database on every call rather than carried in the
 * JWT. Tokens last seven days, so a role baked into one would keep working for
 * a week after it was revoked — and the thing it unlocks is which model the
 * whole deployment calls and what that costs. A query per admin request is a
 * cheap price for revocation taking effect immediately.
 *
 * Runs after `requireAuth`, which is what puts `userId` on the request.
 */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const { userId } = req as AuthedRequest;
  if (!userId) {
    next(unauthorized());
    return;
  }

  prisma.user
    .findUnique({ where: { id: userId }, select: { role: true } })
    .then((user) => {
      if (user?.role !== "admin") {
        // 403 rather than 404: the route's existence isn't a secret, and telling
        // a signed-in non-admin "not allowed" is more useful than pretending the
        // page isn't there when the nav might still link to it.
        next(forbidden("Admin access required"));
        return;
      }
      next();
    })
    .catch(next);
}
