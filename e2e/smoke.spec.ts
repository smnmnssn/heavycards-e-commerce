import { expect, test } from "@playwright/test";

test.describe("smoke", () => {
  test("homepage renders in Swedish without console errors", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const failedResponses: string[] = [];
    page.on("console", (message) => {
      // Resource failures are checked by URL below; the console text has none.
      if (
        message.type() === "error" &&
        !message.text().startsWith("Failed to load resource")
      ) {
        consoleErrors.push(message.text());
      }
    });
    page.on("response", (res) => {
      if (res.status() >= 400) {
        failedResponses.push(`${res.status()} ${res.url()}`);
      }
    });

    const response = await page.goto("/");

    expect(response?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", "sv");
    await expect(page).toHaveTitle(/^HeavyCards/);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Förseglade Pokémon TCG-produkter",
      }),
    ).toBeVisible();
    // Grace period for viewport prefetches (the app never reaches
    // "networkidle", so wait a fixed, short time instead).
    await page.waitForTimeout(1_000);
    expect(consoleErrors).toEqual([]);
    // Includes Next.js link prefetches: every linked route must exist.
    expect(failedResponses).toEqual([]);
  });

  test("responses carry baseline security headers", async ({ request }) => {
    const response = await request.get("/");
    const headers = response.headers();

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["content-security-policy"]).toBe("frame-ancestors 'none'");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["x-powered-by"]).toBeUndefined();
    expect(headers["x-robots-tag"]).toBeUndefined();
  });

  test("health endpoint reports ok and is not indexable", async ({
    request,
  }) => {
    const response = await request.get("/api/health");

    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("admin paths are not indexable even bef.ore the admin exists", async ({
    request,
  }) => {
    const response = await request.get("/admin");

    expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  });

  test("unknown pages return a Swedish 404", async ({ page }) => {
    const response = await page.goto("/finns-inte");

    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: "Sidan hittades inte" }),
    ).toBeVisible();
  });
});
