import path from "node:path";

/**
 * Re-exported so callers read secret resolution as part of this app's config,
 * which is where it belongs conceptually. The implementation lives in
 * `@repo/ai` next to the code that consumes it — and, importantly, in one place:
 * an allowlist with two copies is an allowlist with a hole.
 */
export { isAllowedSecretRef, listSecretRefs, resolveSecretRef } from "@repo/ai";

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

/** The browser's origin. Hoisted because CORS and Stripe's return URLs share it. */
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";

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

/**
 * Stripe is optional in the same way OAuth is.
 *
 * Without a secret key the billing routes still mount and still answer — plans
 * are listed, the free tier meters normally, and only checkout itself reports
 * that payments aren't configured. That ordering matters: `/pricing` is a page
 * about the product, and a deployment with no Stripe account should render it
 * rather than 500 on it.
 *
 * The webhook secret is separate because it can legitimately be absent while the
 * key is present — a developer testing checkout before running `stripe listen`.
 * Verification is not optional, though: a webhook that arrives with no secret
 * configured to check it against is rejected, never trusted.
 */
const stripe = process.env.STRIPE_SECRET_KEY
  ? {
      secretKey: process.env.STRIPE_SECRET_KEY,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? null,
    }
  : null;

export const config = {
  isProduction,
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: required("JWT_SECRET", "underleaf-dev-secret-do-not-use-in-production"),
  webOrigin,
  apiOrigin,
  cookieName: "underleaf_token",
  /** Seven days, in seconds and milliseconds. */
  tokenTtlSeconds: 60 * 60 * 24 * 7,
  tokenTtlMs: 1000 * 60 * 60 * 24 * 7,
  oauth,
  /** True when at least one provider is fully configured. */
  oauthEnabled: Boolean(oauth.google || oauth.github),
  stripe,
  /** True when checkout can actually be started. */
  stripeEnabled: Boolean(stripe),
  /**
   * Where Stripe returns the buyer, on each of its two exits.
   *
   * Both go to a page that already existed and can say something useful: success
   * to settings, which is where the plan and its allowance live and which waits
   * out the webhook before confirming, and cancelling back to pricing with the
   * cards still on screen. Neither is a dedicated route whose only job would be
   * to redirect to one of these.
   *
   * The checkout route appends `&plan=<key>` to the success URL so the page knows
   * which plan to wait for — see the comment there for why it can't infer it.
   */
  billingSuccessUrl: `${webOrigin}/settings?checkout=success`,
  billingCancelUrl: `${webOrigin}/pricing?checkout=cancelled`,
  /**
   * Where uploaded PDFs and their rendered page images live. Absolute so the
   * server's working directory can't move the store, and resolved once here so
   * the storage driver never has to guess.
   *
   * This is the local-disk stand-in for a bucket. Swapping to S3/R2 means adding
   * a driver in services/storage.ts and reading credentials here — the rest of
   * the app only ever sees opaque keys.
   */
  storageDir: path.resolve(process.env.STORAGE_DIR ?? ".storage"),
  /**
   * Cap on uploaded PDF size. Parsing and rasterizing is CPU- and memory-heavy
   * and runs in-process, so this is a load-bearing limit, not just a UX nicety.
   */
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 15 * 1024 * 1024),
  /**
   * Cap on page count, checked as soon as the document opens and before any page
   * is rasterized. Size alone doesn't bound the work: a 2MB text-heavy report can
   * carry far more pages — and so more rendering, more rows, and a longer wait —
   * than a 14MB file that is three pages of photographs. This is the limit that
   * actually tracks the cost of a parse.
   */
  maxPdfPages: Number(process.env.MAX_PDF_PAGES ?? 30),
} as const;

if (isProduction && !process.env.DATABASE_URL) {
  throw new Error("Missing required environment variable: DATABASE_URL");
}
