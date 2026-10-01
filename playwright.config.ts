import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

import { EMAIL_OUTBOX_DIR } from "./e2e/admin-helpers";
import { E2E_STORAGE_DIR } from "./e2e/storage-dir";

// Some tests look up seeded product IDs (read-only). Mirror Next.js and
// prisma.config.ts for local runs; CI provides DATABASE_URL directly.
if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const isCI = Boolean(process.env.CI);
const CATALOG_ADMIN_SPEC = /admin-catalog\.spec\.ts$/;
const CHECKOUT_SPEC = /checkout\.spec\.ts$/;
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
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: [CATALOG_ADMIN_SPEC, CHECKOUT_SPEC],
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
      testIgnore: [CATALOG_ADMIN_SPEC, CHECKOUT_SPEC],
    },
    // Catalog administration publishes and edits products, which would change
    // the listings the storefront tests count on. It therefore runs after
    // them (one browser profile; its mobile checks set their own viewport)
    // and removes everything it created.
    {
      name: "catalog-admin",
      use: { ...devices["Desktop Chrome"] },
      testMatch: CATALOG_ADMIN_SPEC,
      dependencies: ["desktop-chromium", "mobile-chromium"],
      // In order, in one worker: the spec cleans up its data in beforeAll.
      fullyParallel: false,
    },
    // Checkout creates products, pending orders and reservations. It runs
    // last, on its own products, and removes them again; its phone-sized
    // tests set their own device.
    {
      name: "checkout",
      use: { ...devices["Desktop Chrome"] },
      testMatch: CHECKOUT_SPEC,
      dependencies: ["catalog-admin"],
      fullyParallel: false,
    },
  ],
  webServer: {
    command: `npm run start -- --port ${port}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
    // Auth origin checks need APP_URL to match the server's own origin.
    env: {
      APP_URL: baseURL,
      EMAIL_TRANSPORT: "file",
      EMAIL_OUTBOX_DIR,
      // Uploaded product images go to a local, git-ignored directory.
      STORAGE_PROVIDER: "local",
      STORAGE_LOCAL_DIR: E2E_STORAGE_DIR,
      // Checkout never contacts Stripe in E2E: the in-process fake returns
      // checkout.stripe.com URLs, which the tests intercept.
      PAYMENT_GATEWAY: "fake",
    },
  },
});
