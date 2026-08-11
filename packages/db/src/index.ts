import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@prisma/client";

/**
 * Cached on globalThis so dev hot-reloads reuse one client instead of opening a
 * new connection pool per reload until Postgres refuses connections.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Neon is reached through its serverless driver rather than a TCP socket: the
 * driver tunnels the Postgres protocol over a WebSocket on 443, which works on
 * networks that block outbound 5432 (many home and corporate ones do, including
 * the one this was developed on).
 *
 * Keyed off the host so a plain Postgres URL — the local docker-compose one —
 * still takes Prisma's normal TCP path with no adapter involved.
 */
function isNeon(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname.endsWith(".neon.tech");
  } catch {
    return false;
  }
}

function createClient(): PrismaClient {
  const log: ("warn" | "error")[] =
    process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"];
  const url = process.env.DATABASE_URL;

  if (!isNeon(url)) return new PrismaClient({ log });

  // Bun and Node 22 both ship a global WebSocket; the driver only needs to be
  // told which constructor to use.
  neonConfig.webSocketConstructor ??= WebSocket;

  return new PrismaClient({ adapter: new PrismaNeon({ connectionString: url }), log });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export { Prisma } from "@prisma/client";
export type {
  User,
  Template,
  Resume,
  Profession,
  TemplateProfession,
  PdfDocument,
  PdfPage,
  PdfTextRun,
  AiProviderConfig,
  AiUsageLog,
  ChatSession,
  ChatMessage,
  AtsScoreResult,
  JdComparison,
  CoverLetter,
} from "@prisma/client";
