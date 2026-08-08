import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "@repo/db";
import {
  changePasswordBodySchema,
  deleteAccountBodySchema,
  loginBodySchema,
  signupBodySchema,
  updateProfileBodySchema,
  type PublicUser,
} from "@repo/types";
import { asyncHandler, HttpError, badRequest, unauthorized, validateBody } from "../middleware/errors.js";
import { clearAuthCookie, requireAuth, setAuthCookie, signToken, type AuthedRequest } from "../middleware/auth.js";
import { storage, storageKeys } from "../services/storage.js";

export const authRouter = Router();

const BCRYPT_ROUNDS = 12;

/**
 * Same message and comparable timing whether the email or the password was
 * wrong, so endpoints never confirm which emails have accounts. An OAuth-only
 * user has no passwordHash, so comparing against this keeps the timing constant
 * and still rejects.
 */
const DUMMY_HASH = "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv";

function toPublicUser(user: {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  passwordHash: string | null;
  oauthProvider: string | null;
}): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString(),
    // The hash itself never leaves the server; whether one exists is what the
    // settings page needs in order to say "change" instead of "set".
    hasPassword: user.passwordHash !== null,
    oauthProvider: user.oauthProvider,
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

// --- Account settings ---
//
// Every route below acts on the caller's own row and nothing else: the id comes
// from the verified token, never from the request body or path, so there is no
// object to scope and no id an attacker could substitute.

authRouter.patch(
  "/me",
  requireAuth,
  validateBody(updateProfileBodySchema),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { name, email } = req.body;

    const data: { name?: string; email?: string } = {};
    if (name !== undefined) data.name = name.trim();

    if (email !== undefined) {
      const normalizedEmail = email.trim().toLowerCase();

      // Checked explicitly rather than caught as a unique-constraint violation,
      // so the conflict reads as a 409 with a sentence a person can act on. The
      // race between this and the update is closed by the constraint itself,
      // which would still reject a duplicate — just less legibly.
      const taken = await prisma.user.findFirst({
        where: { email: normalizedEmail, NOT: { id: req.userId } },
        select: { id: true },
      });
      if (taken) throw new HttpError(409, "An account with that email already exists");

      data.email = normalizedEmail;
    }

    const user = await prisma.user.update({ where: { id: req.userId }, data });
    res.json({ user: toPublicUser(user) });
  }),
);

authRouter.put(
  "/me/password",
  requireAuth,
  validateBody(changePasswordBodySchema),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) {
      clearAuthCookie(res);
      throw unauthorized("Account no longer exists");
    }

    // An account with a password must prove it — a stolen session shouldn't be
    // enough to lock the real owner out. An OAuth-only account has none to
    // prove, so this is the one path that sets a first password from the session
    // alone, which is exactly as strong as the OAuth login that created it.
    if (user.passwordHash) {
      const matches = await bcrypt.compare(currentPassword ?? "", user.passwordHash);
      if (!currentPassword || !matches) throw unauthorized("Current password is incorrect");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS) },
    });

    // The token carries only a user id, so a password change doesn't invalidate
    // it. Reissuing keeps the session alive with a fresh expiry rather than
    // silently leaving the old cookie to run out early.
    setAuthCookie(res, signToken(user.id));
    res.status(204).end();
  }),
);

authRouter.delete(
  "/me",
  requireAuth,
  validateBody(deleteAccountBodySchema),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { password, confirmEmail } = req.body;

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) {
      clearAuthCookie(res);
      throw unauthorized("Account no longer exists");
    }

    // Proof of intent, matched to what the account actually has: a password user
    // retypes their password, an OAuth-only user retypes their own email.
    if (user.passwordHash) {
      const matches = await bcrypt.compare(password ?? "", user.passwordHash);
      if (!password || !matches) throw unauthorized("Password is incorrect");
    } else if ((confirmEmail ?? "").trim().toLowerCase() !== user.email.toLowerCase()) {
      throw badRequest("Type your email address to confirm");
    }

    // Blobs first. Prisma's onDelete: Cascade clears every resume, PDF document,
    // page and run, but nothing in the database knows the files exist — deleting
    // the row first would orphan them with no id left to find them by. A failure
    // here aborts before the row goes, so the account can be deleted again.
    await storage.deletePrefix(storageKeys.user(user.id));
    await prisma.user.delete({ where: { id: user.id } });

    clearAuthCookie(res);
    res.status(204).end();
  }),
);
