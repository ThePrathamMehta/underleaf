import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { neonConfig, Pool } from "@neondatabase/serverless";

/**
 * Applies pending migrations over Neon's WebSocket driver.
 *
 * `prisma migrate deploy` can't do this here. Its classic engine needs TCP 5432,
 * which this network blocks outbound, and its JavaScript engine — the one that
 * does speak through the driver adapter — fails to deserialize Postgres's
 * internal `name` type when it reads the migrations table. What's left is to
 * apply the SQL directly and record it in the same `_prisma_migrations` table
 * Prisma would have written, so `migrate status` and a later `migrate deploy`
 * from an unrestricted network both still agree with the database.
 *
 * Only handles forward application of committed migrations, which is what
 * deploys need. Authoring a migration is still `prisma migrate dev` against
 * local Postgres, where the normal engine works.
 */

const MIGRATIONS_DIR = path.join(import.meta.dirname, "..", "prisma", "migrations");

// Prisma's own DDL for its bookkeeping table, so a database initialized here is
// indistinguishable from one initialized by the CLI.
const MIGRATIONS_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    id                  VARCHAR(36) PRIMARY KEY NOT NULL,
    checksum            VARCHAR(64) NOT NULL,
    finished_at         TIMESTAMPTZ,
    migration_name      VARCHAR(255) NOT NULL,
    logs                TEXT,
    rolled_back_at      TIMESTAMPTZ,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_steps_count INTEGER NOT NULL DEFAULT 0
  );
`;

function requireConnectionString(): string {
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Set DIRECT_DATABASE_URL (or DATABASE_URL) before migrating.");
  return url;
}

async function readMigrations() {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });

  // Prisma's directory names are timestamp-prefixed, so lexicographic order is
  // chronological order.
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(path.join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");
      return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
    }),
  );
}

async function main() {
  neonConfig.webSocketConstructor = WebSocket;
  const pool = new Pool({ connectionString: requireConnectionString() });

  try {
    const migrations = await readMigrations();
    await pool.query(MIGRATIONS_TABLE_DDL);

    const { rows } = await pool.query<{ migration_name: string }>(
      `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    );
    const applied = new Set(rows.map((row) => row.migration_name));

    const pending = migrations.filter((migration) => !applied.has(migration.name));
    if (pending.length === 0) {
      console.log(`No pending migrations. ${applied.size} already applied.`);
      return;
    }

    console.log(`${pending.length} pending migration(s):`);

    for (const migration of pending) {
      process.stdout.write(`  ${migration.name} ... `);

      // One connection for the whole migration so the DDL and its bookkeeping
      // row commit together — a half-applied migration recorded as finished is
      // the one outcome worth ruling out.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO "_prisma_migrations"
             (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
           VALUES ($1, $2, $3, now(), now(), 1)`,
          [randomUUID(), migration.checksum, migration.name],
        );
        await client.query("COMMIT");
        console.log("done");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        console.log("failed");
        throw error;
      } finally {
        client.release();
      }
    }

    console.log(`Applied ${pending.length} migration(s).`);
  } finally {
    await pool.end();
  }
}

await main();
