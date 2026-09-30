import { existsSync } from "node:fs";

import type { PrismaClient } from "@/generated/prisma/client";
import { createPrismaClient } from "@/lib/db/create-client";

/**
 * Database tests truncate every table, so they must only ever touch a
 * dedicated test database. TEST_DATABASE_URL is required and its database
 * name must end in `_test`; DATABASE_URL is deliberately never used here.
 */
export function getTestDatabaseUrl(): string {
  if (!process.env.TEST_DATABASE_URL && existsSync(".env.local")) {
    process.loadEnvFile(".env.local");
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. See README → Testing for the local test database.",
    );
  }
  const databaseName = new URL(url).pathname.replace(/^\//, "");
  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `Refusing to run database tests against "${databaseName}": the database name must end with "_test".`,
    );
  }
  return url;
}

export function createTestDb(): PrismaClient {
  return createPrismaClient(getTestDatabaseUrl());
}

/**
 * Empties all application tables and restarts sequences, so every test sees
 * a fresh database with order numbers starting at 10001 again.
 */
export async function resetDatabase(db: PrismaClient): Promise<void> {
  const tables = await db.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  const list = tables.map(({ tablename }) => `"${tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}
