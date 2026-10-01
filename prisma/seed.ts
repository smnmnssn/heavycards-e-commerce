import { hashPassword } from "better-auth/crypto";

import { MIN_PASSWORD_LENGTH } from "@/lib/auth/policy";
import { createPrismaClient } from "@/lib/db/create-client";

import { assertSeedAllowed } from "./seed/guard";
import { seedDatabase } from "./seed/seed-database";

// Run with `npm run db:seed`. Env files are loaded by prisma.config.ts.
assertSeedAllowed(process.env);

// Optional local-only password for the development administrators. There is
// no default: without it the seeded administrators cannot sign in.
const adminPassword = process.env.SEED_ADMIN_PASSWORD || undefined;
if (adminPassword !== undefined && adminPassword.length < MIN_PASSWORD_LENGTH) {
  throw new Error(
    `SEED_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`,
  );
}

const db = createPrismaClient(process.env.DATABASE_URL!);
try {
  const summary = await seedDatabase(db, new Date(), {
    adminPasswordHash: adminPassword
      ? await hashPassword(adminPassword)
      : undefined,
  });
  console.info("Development seed complete:", {
    ...summary,
    adminPasswords: adminPassword ? "set from SEED_ADMIN_PASSWORD" : "none",
  });
} finally {
  await db.$disconnect();
}
