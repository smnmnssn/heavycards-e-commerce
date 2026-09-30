import { createPrismaClient } from "@/lib/db/create-client";

import { assertSeedAllowed } from "./seed/guard";
import { seedDatabase } from "./seed/seed-database";

// Run with `npm run db:seed`. Env files are loaded by prisma.config.ts.
assertSeedAllowed(process.env);

const db = createPrismaClient(process.env.DATABASE_URL!);
try {
  const summary = await seedDatabase(db);
  console.info("Development seed complete:", summary);
} finally {
  await db.$disconnect();
}
