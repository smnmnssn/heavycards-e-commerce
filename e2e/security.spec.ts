import { expect, test, type Page } from "@playwright/test";

import { contentSecurityPolicy } from "../src/lib/security/content-security-policy";

import {
  isolateClientIp,
  login,
  SEEDED_OWNER,
  seededPassword,
} from "./admin-helpers";

/*
 * Milestone 14: browser hardening and error hygiene, checked against the
 * production build. The CSP is only useful if it is enforced *and* the site
 * still works, so pages are used in a real browser while every CSP
 * violation the browser reports is collected.
 */

test.beforeEach(async ({ context }) => {
  await isolateClientIp(context);
});

const PRODUCT = "/pokemon-tcg/destined-rivals-booster-box";

/** Collects the browser's CSP violation reports for a page. */
function cspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (
      /Content Security Policy|Refused to (load|execute|connect|apply)/.test(
        text,
      )
    ) {
      violations.push(text);
    }
  });
  page.on("pageerror", (error) => {
    if (/Content Security Policy/.test(error.message)) {
      violations.push(error.message);
    }
  });
  return violations;
}

test.describe("security headers", () => {
  test("storefront pages send the storefront CSP and browser hardening", async ({
    request,
  }) => {
    for (const path of ["/", PRODUCT, "/kassa/avbruten", "/sok?q=box"]) {
      const headers = (await request.get(path)).headers();
      expect(headers["content-security-policy"], path).toBe(
        contentSecurityPolicy({ development: false }),
      );
      expect(headers["cross-origin-opener-policy"], path).toBe("same-origin");
      expect(headers["x-frame-options"], path).toBe("DENY");
      expect(headers["x-content-type-options"], path).toBe("nosniff");
      expect(headers["permissions-policy"], path).toContain("payment=()");
    }
  });

  test("admin pages get a fresh nonce policy that Next.js applies to its scripts", async ({
    request,
  }) => {
    const nonces: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const response = await request.get("/admin/login");
      const policy = response.headers()["content-security-policy"]!;
      const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
      expect(policy).toBe(contentSecurityPolicy({ development: false, nonce }));
      // Every script element of the page carries this response's nonce.
      const html = await response.text();
      const scripts = html.match(/<script\b[^>]*>/g) ?? [];
      expect(scripts.length).toBeGreaterThan(0);
      for (const script of scripts) {
        if (script.includes('type="application/ld+json"')) continue;
        expect(script).toContain(`nonce="${nonce}"`);
      }
      nonces.push(nonce!);
    }
    expect(nonces[0]).not.toBe(nonces[1]);
  });

  test("private pages are never cached, indexed or leaked as a referrer", async ({
    request,
  }) => {
    for (const path of [
      "/admin/login",
      "/admin/forgot-password",
      "/kassa/bekraftelse?session_id=cs_test_unknown",
      `/review/${"A".repeat(43)}`,
    ]) {
      const headers = (await request.get(path)).headers();
      expect(headers["cache-control"], path).toContain("no-store");
      expect(headers["x-robots-tag"], path).toBe("noindex, nofollow");
      expect(headers["referrer-policy"], path).toBe("no-referrer");
    }
  });
});

test.describe("the site works under its CSP", () => {
  test("storefront: browse, add to cart and open the drawer without violations", async ({
    page,
  }) => {
    const violations = cspViolations(page);

    await page.goto("/");
    await page.goto(PRODUCT);
    await page.getByRole("button", { name: "Lägg i kundvagn" }).click();
    await expect(page.getByTestId("cart-badge")).toHaveText("1");
    await page
      .getByRole("banner")
      .getByRole("button", { name: /^Kundvagn/ })
      .click();
    await expect(
      page.getByRole("dialog", { name: /Din kundvagn/ }),
    ).toBeVisible();
    // Product images load through the optimizer on our own origin.
    await expect(
      page.getByRole("main").getByRole("img").first(),
    ).toHaveJSProperty("complete", true);

    expect(violations).toEqual([]);
  });

  test("admin: sign in and use the main screens without violations", async ({
    page,
  }) => {
    test.skip(
      test.info().project.name !== "desktop-chromium",
      "one browser profile is enough for the admin pages",
    );
    const violations = cspViolations(page);

    await login(page, SEEDED_OWNER, seededPassword());
    await expect(page).toHaveURL("/admin");
    for (const path of [
      "/admin/orders",
      "/admin/reviews",
      "/admin/products",
      "/admin/products/new",
      "/admin/settings",
      "/admin/users",
    ]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
    // A client-side form still validates (React hydrated under the nonce).
    await page.goto("/admin/products/new");
    await page.getByRole("button", { name: "Skapa produkt" }).click();
    await expect(
      page.getByText("Kontrollera de markerade fälten."),
    ).toBeVisible();

    expect(violations).toEqual([]);
  });
});

test.describe("public errors reveal no internals", () => {
  const INTERNALS =
    /prisma|postgres|SELECT |stack|node_modules|[\\/]src[\\/]|DATABASE_URL|STRIPE_|whsec_|sk_(test|live)_|at [\w.]+ \(/i;

  test("malformed and unauthorized requests get short, generic answers", async ({
    request,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const cases: Array<[string, () => ReturnType<typeof request.get>, number]> =
      [
        [
          "checkout with broken JSON",
          () =>
            request.post("/api/checkout", {
              headers: { origin, "content-type": "application/json" },
              data: "{ not json",
            }),
          400,
        ],
        [
          "checkout with a client total",
          () =>
            request.post("/api/checkout", {
              headers: { origin, "content-type": "application/json" },
              data: { attemptId: "x", lines: [], totalAmount: 1 },
            }),
          400,
        ],
        [
          "cart with broken JSON",
          () =>
            request.post("/api/cart", {
              headers: { "content-type": "application/json" },
              data: "{",
            }),
          400,
        ],
        [
          "webhook with a forged signature",
          () =>
            request.post("/api/stripe/webhook", {
              headers: { "stripe-signature": "t=1,v1=00" },
              data: '{"id":"evt_x"}',
            }),
          400,
        ],
        [
          "cron without its secret",
          () => request.get("/api/cron/reconcile-checkouts"),
          401,
        ],
        [
          "image upload without a session",
          () =>
            request.post(
              "/api/admin/products/01999999-0000-7000-8000-00000000000a/images",
              { headers: { origin }, multipart: { file: "x" } },
            ),
          401,
        ],
        [
          "media path traversal",
          () => request.get("/api/media/..%2F..%2Fpackage.json"),
          404,
        ],
        ["auth sign-up", () => request.post("/api/auth/sign-up/email"), 404],
      ];

    for (const [label, send, status] of cases) {
      const response = await send();
      const body = await response.text();
      expect(response.status(), label).toBe(status);
      expect(body.length, label).toBeLessThan(300);
      expect(body, label).not.toMatch(INTERNALS);
    }
  });

  test("an unknown page is a plain Swedish 404", async ({ page }) => {
    const response = await page.goto("/pokemon-tcg/finns-inte-alls");
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: "Sidan hittades inte" }),
    ).toBeVisible();
    expect(await page.locator("body").innerText()).not.toMatch(INTERNALS);
  });
});
