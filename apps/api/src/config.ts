const isProduction = process.env.NODE_ENV === "production";

function required(name: string, devFallback?: string): string {
  const value = process.env[name];
  if (value && value.length > 0) return value;

  // A weak default secret in production would silently make every JWT forgeable,
  // so that case is fatal. In dev, a stable fallback keeps setup frictionless.
  if (isProduction || devFallback === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return devFallback;
}

/** This server's own origin, where OAuth providers send their callbacks. */
const apiOrigin = process.env.API_ORIGIN ?? `http://localhost:${Number(process.env.PORT ?? 4000)}`;

/**
 * OAuth is optional. Each provider is enabled only when both its id and secret
 * are present, so a deployment without credentials boots exactly as before and
 * the provider's routes are simply never mounted.
 */
const oauth = {
  google:
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackUrl: `${apiOrigin}/auth/google/callback`,
        }
      : null,
  github:
    process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? {
          clientId: process.env.GITHUB_CLIENT_ID,
          clientSecret: process.env.GITHUB_CLIENT_SECRET,
          callbackUrl: `${apiOrigin}/auth/github/callback`,
        }
      : null,
} as const;

export const config = {
  isProduction,
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: required("JWT_SECRET", "underleaf-dev-secret-do-not-use-in-production"),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  apiOrigin,
  cookieName: "underleaf_token",
  /** Seven days, in seconds and milliseconds. */
  tokenTtlSeconds: 60 * 60 * 24 * 7,
  tokenTtlMs: 1000 * 60 * 60 * 24 * 7,
  oauth,
  /** True when at least one provider is fully configured. */
  oauthEnabled: Boolean(oauth.google || oauth.github),
} as const;

if (isProduction && !process.env.DATABASE_URL) {
  throw new Error("Missing required environment variable: DATABASE_URL");
}
