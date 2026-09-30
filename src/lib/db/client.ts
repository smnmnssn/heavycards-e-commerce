import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env/server";

import { createPrismaClient } from "./create-client";

// Reuse one client (and connection pool) per server process. In development,
// hot reloading re-evaluates modules, so the instance is cached on globalThis
// to avoid exhausting database connections.
const globalForDb = globalThis as typeof globalThis & { db?: PrismaClient };

export const db: PrismaClient =
  globalForDb.db ?? createPrismaClient(env.databaseUrl);

if (env.nodeEnv !== "production") {
  globalForDb.db = db;
}
