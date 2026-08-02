// Writes local .env files for development. Generates a random JWT secret rather
// than committing one, so a checked-out repo never carries a usable key.
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
// Port must match the host-side mapping in docker-compose.yml.
const DATABASE_URL = "postgresql://underleaf:underleaf@localhost:5442/underleaf?schema=public";

const files = [
  {
    path: join(root, "packages/db/.env"),
    contents: `DATABASE_URL="${DATABASE_URL}"\n`,
  },
  {
    path: join(root, "apps/api/.env"),
    contents: [
      `DATABASE_URL="${DATABASE_URL}"`,
      `JWT_SECRET="${randomBytes(48).toString("base64url")}"`,
      `PORT=4000`,
      `WEB_ORIGIN="http://localhost:3000"`,
      "",
    ].join("\n"),
  },
  {
    path: join(root, "apps/web/.env.local"),
    contents: `NEXT_PUBLIC_API_URL="http://localhost:4000"\n`,
  },
];

for (const file of files) {
  if (existsSync(file.path)) {
    console.log(`  kept    ${file.path.replace(root, ".")} (already exists)`);
    continue;
  }
  await writeFile(file.path, file.contents);
  console.log(`  created ${file.path.replace(root, ".")}`);
}
