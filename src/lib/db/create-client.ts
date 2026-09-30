import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * Creates a Prisma client over the `pg` driver adapter (required by Prisma 7).
 *
 * Application code must use the shared instance from `@/lib/db/client`. This
 * factory exists for scripts (seed) and database tests, which run outside
 * Next.js and manage their own client lifecycle.
 */
export function createPrismaClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({
    connectionString,
    // Fail fast instead of hanging a request when the database is unreachable.
    connectionTimeoutMillis: 5_000,
  });
  return new PrismaClient({ adapter });
}
