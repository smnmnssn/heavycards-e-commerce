import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/*
 * Storefront shell: header, navigation, mobile menu, footer and accessibility.
 * Every test runs on desktop and mobile Chromium; viewport-specific tests
 * skip themselves on the other project.
 */

const isMobile = (projectName: string) => projectName.startsWith("mobile");

async function expectNoAxeViolations(page: Page) {
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

test.describe("shell on every page", () => {
  for (const path of ["/", "/om-oss", "/finns-inte"]) {
    test(`${path} has header, main and footer landmarks and no axe violations`, async ({
      page,
    }) => {
      await page.goto(path);

      await expect(page.getByRole("banner")).toBeVisible();
      await expect(page.getByRole("main")).toBeVisible();
      await expect(page.getByRole("contentinfo")).toBeVisible();
      await expect(
        page.getByRole("link", { name: "HeavyCards – till startsidan" }),
      ).toHaveAttribute("href", "/");
      await expectNoAxeViolations(page);
    });
  }

  test("skip link moves keyboard focus to the main content", async ({
    page,
  }) => {
    await page.goto("/");

    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", { name: "Hoppa till innehållet" });
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeInViewport();

    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
  });

  test("the empty cart opens only when the cart button is clicked", async ({
    page,
  }) => {
    await page.goto("/");
    const cart = page.getByRole("button", { name: "Kundvagn, tom" });

    await expect(cart).toBeVisible();
    await expect(page.getByTestId("cart-badge")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await cart.click();
    const drawer = page.getByRole("dialog", { name: /Din kundvagn/ });
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("Din kundvagn är tom.");
  });

  test("footer carries information links and the independence notice", async ({
    page,
  }) => {
    await page.goto("/");
    const footer = page.getByRole("contentinfo");

    for (const name of [
      "Kontakt",
      "Retur & ångerrätt",
      "Köpvillkor",
      "Integritetspolicy",
      "Cookiepolicy",
    ]) {
      await expect(footer.getByRole("link", { name })).toBeVisible();
    }
    await expect(footer).toContainText(
      "inte ansluten till eller godkänd av The Pokémon Company",
    );
  });

  test("placeholder information pages are not indexable", async ({ page }) => {
    await page.goto("/kopvillkor");

    await expect(
      page.getByRole("heading", { level: 1, name: "Köpvillkor" }),
    ).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
    await expect(
      page.getByRole("navigation", { name: "Brödsmulor" }),
    ).toContainText("Hem");
  });

  test("the design reference page does not exist in production", async ({
    page,
  }) => {
    const response = await page.goto("/designsystem");

    expect(response?.status()).toBe(404);
  });

  test("layout never scrolls horizontally", async ({ page }) => {
    for (const path of ["/", "/om-oss"]) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }
  });
});

test.describe("desktop header", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(isMobile(testInfo.project.name), "desktop-only layout");
  });

  test("shows the primary navigation and hides the menu button", async ({
    page,
  }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Huvudmeny" });

    await expect(nav).toBeVisible();
    const links = nav.getByRole("link");
    await expect(links).toHaveText([
      "Nyheter",
      "Pokémon TCG",
      "Kommande",
      "Om oss",
    ]);
    await expect(
      nav.getByRole("link", { name: "Pokémon TCG" }),
    ).toHaveAttribute("href", "/pokemon-tcg");
    await expect(page.getByRole("button", { name: "Öppna meny" })).toBeHidden();
  });

  test("marks the current section in the navigation", async ({ page }) => {
    await page.goto("/");
    await page
      .getByRole("navigation", { name: "Huvudmeny" })
      .getByRole("link", { name: "Om oss" })
      .click();

    await expect(page).toHaveURL("/om-oss");
    await expect(
      page
        .getByRole("navigation", { name: "Huvudmeny" })
        .getByRole("link", { name: "Om oss" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("search field submits to the search page", async ({ page }) => {
    await page.goto("/");
    const search = page
      .getByRole("banner")
      .getByRole("searchbox", { name: "Sök produkter" });

    await search.fill("booster box");
    await search.press("Enter");

    await expect(page).toHaveURL(/\/sok\?q=booster\+box$/);
  });
});

test.describe("mobile header and menu", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!isMobile(testInfo.project.name), "mobile-only layout");
  });

  test("replaces the navigation with menu, search and cart buttons", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(
      page.getByRole("navigation", { name: "Huvudmeny" }),
    ).toBeHidden();
    for (const control of [
      page.getByRole("button", { name: "Öppna meny" }),
      page.getByRole("banner").getByRole("link", { name: "Sök" }),
      page.getByRole("button", { name: "Kundvagn, tom" }),
    ]) {
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      // WCAG 2.5.5 / platform guidance: at least 44×44 px.
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("menu opens as a modal dialog, traps focus and closes with Escape", async ({
    page,
  }) => {
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "Öppna meny" });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    await trigger.click();
    const menu = page.getByRole("dialog", { name: "Meny" });
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(
      menu.getByRole("button", { name: "Stäng meny" }),
    ).toBeFocused();
    await expect(
      menu.getByRole("navigation", { name: "Huvudmeny" }).getByRole("link"),
    ).toHaveText(["Nyheter", "Pokémon TCG", "Kommande", "Om oss"]);
    await expectNoAxeViolations(page);

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  test("menu closes with its close button", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Öppna meny" }).click();
    const menu = page.getByRole("dialog", { name: "Meny" });

    await menu.getByRole("button", { name: "Stäng meny" }).click();

    await expect(menu).toBeHidden();
  });

  test("following a menu link navigates and closes the menu", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Öppna meny" }).click();

    await page
      .getByRole("dialog", { name: "Meny" })
      .getByRole("link", { name: "Om oss" })
      .click();

    await expect(page).toHaveURL("/om-oss");
    await expect(page.getByRole("dialog", { name: "Meny" })).toBeHidden();
    await expect(
      page.getByRole("heading", { level: 1, name: "Om oss" }),
    ).toBeVisible();
  });
});
