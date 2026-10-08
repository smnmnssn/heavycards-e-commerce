import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

/*
 * Milestone 15: no server secret may reach anything the production build
 * serves to browsers: client JavaScript (.next/static) and prerendered
 * pages and RSC payloads (.next/server/app). Checked on the same build the
 * E2E suite runs against, so it covers every import path into client code.
 */

const SECRET_VARIABLES = [
  "AUTH_SECRET",
  "REVIEW_LINK_SECRET",
  "REVIEW_LINK_SECRET_PREVIOUS",
  "CRON_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "BLOB_READ_WRITE_TOKEN",
  "SEED_ADMIN_PASSWORD",
  "DATABASE_URL",
] as const;

/** Shapes of credentials, whatever the build's own values were. */
const SECRET_PATTERNS = [
  /\b(sk|rk)_(live|test)_[A-Za-z0-9]{8,}/,
  /\bwhsec_[A-Za-z0-9]{8,}/,
  /\bvercel_blob_rw_[A-Za-z0-9_]{8,}/,
  /\bpostgres(ql)?:\/\/[^\s"'`]+@/,
];

function files(directory: string, extensions: RegExp): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && extensions.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

test("served build output contains no server secrets", () => {
  test.skip(
    test.info().project.name !== "desktop-chromium",
    "Reads files only; once is enough.",
  );

  const served = [
    ...files(".next/static", /\.(js|css|json)$/),
    ...files(".next/server/app", /\.(html|rsc|body)$/),
  ];
  expect(served.length).toBeGreaterThan(50);

  const values = SECRET_VARIABLES.flatMap((name) => {
    const value = process.env[name];
    if (!value || value.length < 12) return [];
    // The database password alone, too.
    if (name === "DATABASE_URL") {
      const password = decodeURIComponent(new URL(value).password);
      return password.length >= 12 ? [value, password] : [value];
    }
    return [value];
  });

  const leaks: string[] = [];
  for (const file of served) {
    const content = readFileSync(file, "utf8");
    for (const value of values) {
      if (content.includes(value)) leaks.push(`${file}: a configured secret`);
    }
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(content)) leaks.push(`${file}: ${pattern.source}`);
    }
  }
  // Never print the values themselves.
  expect(leaks).toEqual([]);
});
