import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// In dev, Next.js resets module state on every hot reload — without a global
// cache we'd open a new pg pool per change and quickly exhaust connections.
// Reuse a single PrismaClient across reloads in non-production.
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createClient(): PrismaClient {
  // Use an empty string fallback so importing this module never throws —
  // build-time route collection and other lazy paths can succeed before
  // env vars are set. The actual error surfaces on first query, which is
  // the right place to fail loudly.
  const url = process.env.DATABASE_URL ?? "";
  const adapter = new PrismaPg(url);
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
