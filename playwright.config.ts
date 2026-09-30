import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

// Some tests look up seeded product IDs (read-only). Mirror Next.js and
// prisma.config.ts for local runs; CI provides DATABASE_URL directly.
if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const isCI = Boolean(process.env.CI);
const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${port}`;

/**
 * E2E tests run against the production build (`npm run build` first) so they
 * exercise the same rendering and caching behavior as a deployment.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    locale: "sv-SE",
    timezoneId: "Europe/Stockholm",
    trace: "on-first-retry",
  },
  // The storefront is mobile-first, so every flow runs on a phone viewport too.
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npm run start -- --port ${port}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
