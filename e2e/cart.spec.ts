import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { productIds } from "./seeded-products";

/*
 * Guest cart (Milestone 5) against the seeded catalog. Each test starts with
 * an empty browser storage (fresh context).
 */

const BOOSTER_BOX = "/pokemon-tcg/destined-rivals-booster-box"; // 11 available
const BOOSTER_PACK = "/pokemon-tcg/destined-rivals-booster-pack";
const LOW_STOCK_ETB = "/pokemon-tcg/destined-rivals-elite-trainer-box"; // 2
const SOLD_OUT = "/pokemon-tcg/prismatic-evolutions-elite-trainer-box";
const PREORDER_ETB = "/pokemon-tcg/kommande-set-elite-trainer-box"; // +45 days
const PREORDER_BUNDLE = "/pokemon-tcg/kommande-set-booster-bundle"; // +75 days

const addToCart = (page: Page) => page.getByTestId("add-to-cart");
const addButton = (page: Page) =>
  addToCart(page).getByRole("button", {
    name: /Lägg i kundvagn|Förbeställ|Tillagd/,
  });
const cartButton = (page: Page) =>
  page.getByRole("banner").getByRole("button", { name: /^Kundvagn/ });
const badge = (page: Page) => page.getByTestId("cart-badge");
const drawer = (page: Page) =>
  page.getByRole("dialog", { name: /Din kundvagn/ });

async function add(page: Page, path: string, quantity = 1) {
  await page.goto(path);
  for (let i = 1; i < quantity; i += 1) {
    await addToCart(page).getByRole("button", { name: "Öka antal" }).click();
  }
  await addButton(page).click();
  await expect(addButton(page)).toHaveAttribute("data-state", "added");
  await expect(addButton(page)).toHaveAttribute("data-state", "idle", {
    timeout: 3_000,
  });
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
}

test.describe("adding to the cart", () => {
  test("gives feedback without opening the drawer", async ({ page }) => {
    await page.goto(BOOSTER_BOX);
    await expect(cartButton(page)).toHaveAccessibleName("Kundvagn, tom");

    await addButton(page).click();

    // 1. Button confirms, 2. badge updates, 3. icon pulses — drawer stays shut.
    await expect(addButton(page)).toHaveText("✓ Tillagd");
    await expect(badge(page)).toHaveText("1");
    await expect(cartButton(page).locator("[data-pulse]")).toHaveAttribute(
      "data-pulse",
      "1",
    );
    await expect(drawer(page)).toHaveCount(0);
    await expect(cartButton(page)).toHaveAccessibleName("Kundvagn, 1 artikel");
    await expect(
      page.getByRole("status").filter({ hasText: "har lagts i kundvagnen" }),
    ).toHaveCount(1);

    // The label returns after roughly 1–1.5 seconds.
    await expect(addButton(page)).toHaveText("Lägg i kundvagn", {
      timeout: 2_000,
    });
  });

  test("ignores repeated fast clicks during the confirmation", async ({
    page,
  }) => {
    await page.goto(BOOSTER_BOX);

    await addButton(page).click();
    await addButton(page).click();
    await addButton(page).click();

    await expect(badge(page)).toHaveText("1");
  });

  test("works from the keyboard", async ({ page }) => {
    await page.goto(BOOSTER_BOX);

    await addButton(page).focus();
    await page.keyboard.press("Enter");

    await expect(badge(page)).toHaveText("1");
    await expect(addButton(page)).toBeFocused();
  });

  test("still works with reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(BOOSTER_BOX);

    await addButton(page).click();

    await expect(badge(page)).toHaveText("1");
    const duration = await cartButton(page)
      .locator("[data-pulse]")
      .evaluate((el) => getComputedStyle(el).animationDuration);
    expect(Number.parseFloat(duration)).toBeLessThan(0.01);
  });

  test("the badge counts units, not lines", async ({ page }) => {
    await add(page, BOOSTER_BOX, 2);
    await add(page, BOOSTER_PACK, 1);

    await expect(badge(page)).toHaveText("3");
    await cartButton(page).click();
    await expect(drawer(page).getByTestId("cart-line")).toHaveCount(2);
  });

  test("limits quantity to what is available", async ({ page }) => {
    await page.goto(LOW_STOCK_ETB);
    const increase = addToCart(page).getByRole("button", { name: "Öka antal" });

    await increase.click();
    await expect(increase).toBeDisabled(); // only 2 available
    await addButton(page).click();
    await expect(badge(page)).toHaveText("2");

    await expect(addButton(page)).toBeDisabled({ timeout: 3_000 });
    await expect(addToCart(page)).toContainText(
      "Du har redan alla tillgängliga exemplar i kundvagnen.",
    );
  });

  test("sold-out products cannot be added", async ({ page }) => {
    await page.goto(SOLD_OUT);

    await expect(addToCart(page)).toHaveCount(0);
    await expect(
      page.getByRole("main").getByRole("button", { name: "Slutsåld" }),
    ).toBeDisabled();
  });

  test("keeps the cart after a reload", async ({ page }) => {
    await add(page, BOOSTER_BOX, 2);

    await page.reload();

    await expect(badge(page)).toHaveText("2");
  });
});

test.describe("preorder rules", () => {
  test("preorders and in-stock products cannot be mixed", async ({ page }) => {
    await add(page, BOOSTER_BOX);
    await page.goto(PREORDER_ETB);

    await addButton(page).click();

    const alert = addToCart(page).getByRole("alert");
    await expect(alert).toContainText(
      "Förbeställningar och lagerförda produkter behöver beställas separat.",
    );
    await expect(badge(page)).toHaveText("1"); // nothing removed or added

    await alert.getByRole("button", { name: "Visa kundvagnen" }).click();
    await expect(drawer(page)).toBeVisible();
  });

  test("preorders with different release dates cannot be mixed", async ({
    page,
  }) => {
    await add(page, PREORDER_ETB);
    await page.goto(PREORDER_BUNDLE);

    await addButton(page).click();

    await expect(addToCart(page).getByRole("alert")).toContainText(
      "olika släppdatum behöver beställas separat",
    );
    await expect(badge(page)).toHaveText("1");
  });

  test("uses preorder wording", async ({ page }) => {
    await page.goto(PREORDER_ETB);

    await expect(addButton(page)).toHaveText("Förbeställ");
  });
});

test.describe("cart drawer", () => {
  test("opens on click, traps focus, closes with Escape and restores focus", async ({
    page,
  }) => {
    await add(page, BOOSTER_BOX);

    await cartButton(page).click();
    await expect(drawer(page)).toBeVisible();
    await expect(cartButton(page)).toHaveAttribute("aria-expanded", "true");
    await expect(
      drawer(page).getByRole("button", { name: "Stäng kundvagnen" }),
    ).toBeFocused();
    await expectNoAxeViolations(page);

    await page.keyboard.press("Escape");
    await expect(drawer(page)).toHaveCount(0);
    await expect(cartButton(page)).toBeFocused();

    await cartButton(page).click();
    await drawer(page)
      .getByRole("button", { name: "Stäng kundvagnen" })
      .click();
    await expect(drawer(page)).toHaveCount(0);
  });

  test("shows prices, subtotal and an honest checkout state", async ({
    page,
  }) => {
    await add(page, BOOSTER_BOX, 2);
    await cartButton(page).click();
    const cart = drawer(page);

    await expect(cart).toContainText("Destined Rivals Booster Box");
    await expect(cart).toContainText(/2\s199\skr/); // unit price
    await expect(cart).toContainText(/4\s398\skr/); // line total and subtotal
    await expect(cart).toContainText("Beräknas i kassan");
    await expect(
      cart.getByRole("button", { name: "Till kassan" }),
    ).toBeDisabled();
    await expect(cart).toContainText("Kassan öppnar snart.");
  });

  test("changes quantities and removes products", async ({ page }) => {
    await add(page, BOOSTER_BOX);
    await add(page, BOOSTER_PACK);
    await cartButton(page).click();
    const box = drawer(page).getByRole("group", {
      name: "Antal för Destined Rivals Booster Box",
    });

    await box.getByRole("button", { name: "Öka antal" }).click();
    await expect(box.getByRole("spinbutton")).toHaveValue("2");
    await expect(badge(page)).toHaveText("3");

    await box.getByRole("button", { name: "Minska antal" }).click();
    await expect(badge(page)).toHaveText("2");

    await drawer(page)
      .getByRole("button", {
        name: "Ta bort Destined Rivals Booster Pack från kundvagnen",
      })
      .click();
    await expect(drawer(page).getByTestId("cart-line")).toHaveCount(1);
    await expect(badge(page)).toHaveText("1");

    await drawer(page)
      .getByRole("button", {
        name: "Ta bort Destined Rivals Booster Box från kundvagnen",
      })
      .click();
    await expect(drawer(page)).toContainText("Din kundvagn är tom.");
    await expect(badge(page)).toHaveCount(0);
  });

  test("handles a stale persisted cart gracefully", async ({ page }) => {
    const ids = await productIds(["SV10-BB-EN", "SV8PT5-ETB-EN", "ME01-BB-EN"]);
    await page.addInitScript(
      ({ key, value }) => window.localStorage.setItem(key, value),
      {
        key: "heavycards:cart",
        value: JSON.stringify({
          v: 1,
          lines: [
            { id: ids["SV10-BB-EN"], q: 50 }, // more than available
            { id: ids["SV8PT5-ETB-EN"], q: 1 }, // now sold out
            { id: ids["ME01-BB-EN"], q: 1 }, // draft: must reveal nothing
            { id: "01999999-0000-7000-8000-000000000000", q: 1 }, // deleted
          ],
        }),
      },
    );

    await page.goto("/");
    await cartButton(page).click();
    const cart = drawer(page);

    // The exact number depends on active reservations (the seeded pending
    // checkout expires 30 minutes after seeding), so read it from the page.
    const adjusted = cart.getByText(
      /Antalet har ändrats från 50 till \d+ eftersom det bara finns så många kvar\./,
    );
    await expect(adjusted).toBeVisible();
    const available = Number(
      /till (\d+)/.exec((await adjusted.textContent()) ?? "")?.[1],
    );
    expect(available).toBeGreaterThanOrEqual(11);
    expect(available).toBeLessThanOrEqual(12);
    await expect(cart).toContainText(
      "Produkten är slutsåld och kan inte beställas just nu.",
    );
    await expect(
      cart.getByText("Produkten finns inte längre och kan inte beställas."),
    ).toHaveCount(2);
    await expect(cart).not.toContainText("Mega Evolution");
    await expect(
      cart.getByRole("button", { name: "Till kassan" }),
    ).toBeDisabled();
    await expect(cart).toContainText("Åtgärda markerade produkter.");
    // Unavailable lines count until the customer removes them.
    await expect(badge(page)).toHaveText(String(available + 3));
  });

  test("survives corrupt storage", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() =>
      window.localStorage.setItem("heavycards:cart", "{not json"),
    );

    await page.goto(BOOSTER_BOX);

    await expect(cartButton(page)).toHaveAccessibleName("Kundvagn, tom");
    await addButton(page).click();
    await expect(badge(page)).toHaveText("1");
    expect(errors).toEqual([]);
  });

  test("fits the viewport with the checkout area reachable", async ({
    page,
  }) => {
    await add(page, BOOSTER_BOX);
    await cartButton(page).click();

    const viewport = page.viewportSize()!;
    // Wait for the slide-in to settle before measuring.
    await expect
      .poll(async () => {
        const settled = await drawer(page).boundingBox();
        return settled ? settled.x + settled.width : Infinity;
      })
      .toBeLessThanOrEqual(viewport.width + 1);
    const box = (await drawer(page).boundingBox())!;
    expect(box.width).toBeGreaterThan(Math.min(viewport.width * 0.85, 400));
    await expect(
      drawer(page).getByRole("button", { name: "Till kassan" }),
    ).toBeInViewport();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
