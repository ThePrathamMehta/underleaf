import { Router, type Request, type Response } from "express";
import passport from "passport";
import {
  Strategy as GoogleStrategy,
  type Profile as GoogleProfile,
  type VerifyCallback,
} from "passport-google-oauth20";
import { Strategy as GitHubStrategy } from "passport-github2";
import { prisma } from "@repo/db";
import { config } from "../config.js";
import { setAuthCookie, signToken } from "../middleware/auth.js";
import { ensureFreeSubscription } from "../services/entitlements.js";

/**
 * OAuth (Google + GitHub) via Passport, terminating in the SAME JWT httpOnly
 * cookie the password login issues — so `/auth/me`, route protection, and the
 * cookie itself don't care how the user signed in.
 *
 * This module is imported lazily from index.ts only when at least one provider
 * is configured, so a deployment without credentials never loads passport and
 * boots exactly as before.
 */

type NormalizedProfile = {
  provider: "google" | "github";
  providerId: string;
  email: string | null;
  emailVerified: boolean;
  name: string;
};

/** Result of resolving a provider profile to a local user. */
type ResolveResult =
  | { ok: true; user: { id: string; email: string; name: string } }
  | { ok: false; reason: "link-conflict" };

/**
 * Finds or creates the local user for an OAuth identity, applying the linking
 * rule: link to an existing password account by email only when the provider
 * reports that email as verified. Otherwise refuse to merge.
 */
async function resolveUser(profile: NormalizedProfile): Promise<ResolveResult> {
  // 1. Already linked — the common returning-user path.
  const linked = await prisma.user.findFirst({
    where: { oauthProvider: profile.provider, oauthId: profile.providerId },
  });
  if (linked) return { ok: true, user: linked };

  // 2. An account may already exist under this email.
  if (profile.email) {
    const byEmail = await prisma.user.findUnique({ where: { email: profile.email } });
    if (byEmail) {
      // Only link automatically when the provider vouches for the email; never
      // silently merge on an unverified address.
      if (!profile.emailVerified) return { ok: false, reason: "link-conflict" };
      const updated = await prisma.user.update({
        where: { id: byEmail.id },
        data: { oauthProvider: profile.provider, oauthId: profile.providerId },
      });
      return { ok: true, user: updated };
    }
  }

  // 3. Brand-new user. OAuth-only, so no passwordHash.
  const created = await prisma.user.create({
    data: {
      email: profile.email ?? `${profile.provider}_${profile.providerId}@users.noreply.underleaf`,
      name: profile.name || "New User",
      oauthProvider: profile.provider,
      oauthId: profile.providerId,
    },
  });

  // Same free-plan subscription the password signup creates — an account's tier
  // shouldn't depend on which button made it (v5 Section 2).
  await ensureFreeSubscription(created.id);

  return { ok: true, user: created };
}

function normalizeGoogle(profile: GoogleProfile): NormalizedProfile {
  const primary = profile.emails?.[0];
  return {
    provider: "google",
    providerId: profile.id,
    email: primary?.value?.toLowerCase() ?? null,
    // google-oauth20 surfaces verification as a string/boolean on the email.
    emailVerified: primary ? (primary as { verified?: boolean | string }).verified !== false : false,
    name: profile.displayName ?? "",
  };
}

// passport-github2 has loose profile typing; describe just what we read.
type GitHubProfile = {
  id: string;
  displayName?: string;
  username?: string;
  emails?: { value: string; verified?: boolean }[];
};

function normalizeGitHub(profile: GitHubProfile): NormalizedProfile {
  // GitHub only returns verified emails when `user:email` scope is granted; a
  // returned primary email is therefore treated as verified.
  const primary = profile.emails?.[0];
  return {
    provider: "github",
    providerId: String(profile.id),
    email: primary?.value?.toLowerCase() ?? null,
    emailVerified: Boolean(primary),
    name: profile.displayName || profile.username || "",
  };
}

/** Builds the OAuth router with whichever providers are configured. */
export function createOAuthRouter(): Router {
  const router = Router();

  if (config.oauth.google) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: config.oauth.google.clientId,
          clientSecret: config.oauth.google.clientSecret,
          callbackURL: config.oauth.google.callbackUrl,
          scope: ["profile", "email"],
        },
        (_accessToken: string, _refreshToken: string, profile: GoogleProfile, done: VerifyCallback) => {
          // Defer all DB work to the callback handler; just carry the profile.
          done(null, normalizeGoogle(profile));
        },
      ),
    );

    router.get("/google", passport.authenticate("google", { session: false, scope: ["profile", "email"] }));
    router.get("/google/callback", handleCallback("google"));
  }

  if (config.oauth.github) {
    passport.use(
      new GitHubStrategy(
        {
          clientID: config.oauth.github.clientId,
          clientSecret: config.oauth.github.clientSecret,
          callbackURL: config.oauth.github.callbackUrl,
          scope: ["user:email"],
        },
        (_accessToken: string, _refreshToken: string, profile: GitHubProfile, done: VerifyCallback) => {
          done(null, normalizeGitHub(profile));
        },
      ),
    );

    router.get("/github", passport.authenticate("github", { session: false, scope: ["user:email"] }));
    router.get("/github/callback", handleCallback("github"));
  }

  return router;
}

/**
 * Shared callback handler: runs the strategy, resolves the user, issues the
 * session cookie, and redirects into the web app — or back to /login with an
 * error param on any failure (denied consent, provider error, link conflict).
 */
function handleCallback(provider: "google" | "github") {
  return (req: Request, res: Response) => {
    passport.authenticate(
      provider,
      { session: false },
      async (err: unknown, profile: NormalizedProfile | false) => {
        const loginUrl = new URL("/login", config.webOrigin);

        if (err || !profile) {
          loginUrl.searchParams.set("error", "oauth_failed");
          return res.redirect(loginUrl.toString());
        }

        try {
          const result = await resolveUser(profile);
          if (!result.ok) {
            loginUrl.searchParams.set("error", "link_conflict");
            return res.redirect(loginUrl.toString());
          }
          setAuthCookie(res, signToken(result.user.id));
          return res.redirect(new URL("/dashboard", config.webOrigin).toString());
        } catch {
          loginUrl.searchParams.set("error", "oauth_failed");
          return res.redirect(loginUrl.toString());
        }
      },
    )(req, res);
  };
}
