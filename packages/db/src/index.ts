import { PrismaClient } from "@prisma/client";

/**
 * Cached on globalThis so dev hot-reloads reuse one client instead of opening a
 * new connection pool per reload until Postgres refuses connections.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export { Prisma } from "@prisma/client";
export type { User, Template, Resume, Profession, TemplateProfession } from "@prisma/client";
