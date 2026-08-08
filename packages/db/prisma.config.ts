import path from "node:path";
import { defineConfig } from "prisma/config";

/**
 * Replaces the deprecated `package.json#prisma` block.
 *
 * Deliberately does *not* configure a driver adapter for the schema engine.
 * Prisma 6's JavaScript engine — the only one that can reach Neon over a
 * WebSocket — fails to deserialize Postgres's internal `name` type when it reads
 * the migrations table, so `migrate deploy` through it errors before applying
 * anything. Leaving the classic engine in place keeps `prisma migrate dev`
 * working against local Postgres, where authoring happens; applying migrations
 * to Neon from a network that blocks TCP 5432 is what `db:deploy:neon` is for.
 */

// A config file switches off the CLI's own .env loading, so DATABASE_URL has to
// be read in explicitly. Tolerates a missing file: CI and deploys pass the
// variables in through the environment instead.
try {
  process.loadEnvFile?.();
} catch {
  // no .env here — the environment already has what we need, or the CLI will say so
}

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: { seed: "bun run src/seed.ts" },
});
