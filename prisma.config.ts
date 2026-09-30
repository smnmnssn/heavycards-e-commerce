import { existsSync } from "node:fs";

import { defineConfig } from "prisma/config";

// Prisma 7 does not load env files. Mirror Next.js for local development;
// variables already set in the environment (CI, Vercel) take precedence.
if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Not read through `env()` so `prisma generate` (e.g. on install) works
    // without a database. Commands that need a connection fail clearly.
    url: process.env.DATABASE_URL ?? "",
  },
});
