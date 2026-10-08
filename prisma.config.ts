import { existsSync } from "node:fs";

import { defineConfig } from "prisma/config";

import { assertPrismaCommandAllowed } from "./prisma/cli-guard";

// Prisma 7 does not load env files. Mirror Next.js for local development;
// variables already set in the environment (CI, Vercel) take precedence.
if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

// `migrate dev`, `migrate reset` and `db push` only against local databases.
assertPrismaCommandAllowed(process.argv.slice(2), process.env.DATABASE_URL);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Not read through `env()` so `prisma generate` (e.g. on install) works
    // without a database. Commands that need a connection fail clearly.
    // Migrations against Neon use the direct (non-pooled) connection string:
    // run them with DATABASE_URL set to it (docs/launch-runbook.md).
    url: process.env.DATABASE_URL ?? "",
  },
});
