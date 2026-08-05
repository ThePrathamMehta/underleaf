import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "@repo/db";
import { loginBodySchema, signupBodySchema, type PublicUser } from "@repo/types";
import { asyncHandler, HttpError, unauthorized, validateBody } from "../middleware/errors.js";
import { clearAuthCookie, requireAuth, setAuthCookie, signToken, type AuthedRequest } from "../middleware/auth.js";

export const authRouter = Router();

const BCRYPT_ROUNDS = 12;

function toPublicUser(user: { id: string; email: string; name: string; createdAt: Date }): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString(),
  };
}

authRouter.post(
  "/signup",
  validateBody(signupBodySchema),
  asyncHandler(async (req, res) => {
    const { email, password, name } = req.body;
    const normalizedEmail = email.trim().toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      throw new HttpError(409, "An account with that email already exists");
    }

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name: name.trim(),
        passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      },
    });

    setAuthCookie(res, signToken(user.id));
    res.status(201).json({ user: toPublicUser(user) });
  }),
);

authRouter.post(
  "/login",
  validateBody(loginBodySchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });

    // Same message and comparable timing whether the email or the password was
    // wrong, so the endpoint doesn't confirm which emails have accounts. An
    // OAuth-only user has no passwordHash, so compare against a dummy to keep
    // timing constant and still reject.
    const DUMMY_HASH = "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv";
    const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

    if (!user || !user.passwordHash || !passwordMatches) {
      throw unauthorized("Incorrect email or password");
    }

    setAuthCookie(res, signToken(user.id));
    res.json({ user: toPublicUser(user) });
  }),
);

authRouter.post("/logout", (_req, res) => {
  clearAuthCookie(res);
  res.status(204).end();
});

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) {
      // Token is valid but the row is gone (deleted account) — clear the cookie
      // so the client stops retrying with a token that can never resolve.
      clearAuthCookie(res);
      throw unauthorized("Account no longer exists");
    }
    res.json({ user: toPublicUser(user) });
  }),
);
