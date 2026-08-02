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

export const config = {
  isProduction,
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: required("JWT_SECRET", "underleaf-dev-secret-do-not-use-in-production"),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  cookieName: "underleaf_token",
  /** Seven days, in seconds and milliseconds. */
  tokenTtlSeconds: 60 * 60 * 24 * 7,
  tokenTtlMs: 1000 * 60 * 60 * 24 * 7,
} as const;

if (isProduction && !process.env.DATABASE_URL) {
  throw new Error("Missing required environment variable: DATABASE_URL");
}
