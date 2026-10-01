import { randomInt, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * The test server writes emails here as JSON instead of sending them
 * (EMAIL_TRANSPORT=file, set by playwright.config.ts).
 */
export const EMAIL_OUTBOX_DIR = resolve(".e2e-outbox");

export const SEEDED_OWNER = "owner@heavycards.test";
export const SEEDED_ADMIN = "admin@heavycards.test";
export const SEEDED_INACTIVE = "inactive@heavycards.test";

/**
 * Password of the seeded development administrators. It comes from the
 * environment (`.env.local` locally, generated per run in CI) and never from
 * source code.
 */
export function seededPassword(): string {
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) {
    throw new Error(
      "SEED_ADMIN_PASSWORD is not set. Set it and run `npm run db:seed` (README → Admin access).",
    );
  }
  return password;
}

/**
 * Gives a browser context its own client IP. Auth rate limits are per IP, so
 * parallel tests never share a bucket. (On Vercel the platform overwrites
 * this header, so clients cannot choose their IP in production.)
 */
export async function isolateClientIp(context: BrowserContext) {
  await context.setExtraHTTPHeaders({
    "x-forwarded-for": `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`,
  });
}

export const uniqueEmail = (label: string) =>
  `e2e-${label}-${randomUUID().slice(0, 8)}@heavycards.test`;

export async function login(page: Page, email: string, password: string) {
  await page.goto("/admin/login");
  await page.getByLabel("E-postadress").fill(email);
  await page.getByLabel("Lösenord", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Logga in" }).click();
}

/** Waits for the newest email to `to` and returns the first link in it. */
export async function linkFromLatestEmail(to: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        let files: string[] = [];
        try {
          files = (await readdir(EMAIL_OUTBOX_DIR)).sort().reverse();
        } catch {
          return undefined;
        }
        for (const file of files) {
          const email = JSON.parse(
            await readFile(join(EMAIL_OUTBOX_DIR, file), "utf8"),
          ) as { to: string; text: string };
          if (email.to === to) {
            link = email.text.match(/https?:\/\/\S+/)?.[0];
            return link;
          }
        }
        return undefined;
      },
      { message: `email to ${to}`, timeout: 10_000 },
    )
    .toBeTruthy();
  return link!;
}

export async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map((node) => node.target.join(" ")),
    })),
  ).toEqual([]);
}
