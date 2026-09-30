import { execSync } from "node:child_process";

import { getTestDatabaseUrl } from "./test-database";

/** Brings the test database to the latest migration before any DB test runs. */
export default function setup(): void {
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: getTestDatabaseUrl() },
    stdio: ["ignore", "ignore", "inherit"],
  });
}
