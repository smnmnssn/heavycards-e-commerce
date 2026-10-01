import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/*
 * Catalog flows against the seeded development catalog (prisma/seed). Tests
 * reference seeded slugs and states, never pixel positions.
 */

const isMobile = (projectName: string) => projectName.startsWith("mobile");

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
}

/** Visible product card names in order. */
const cardNames = (page: Page) =>
  page
    .getByRole("main")
    .getByRole("article")
    .getByRole("heading")
    .allTextContents();

/** "1 999 kr" → 199900 (öre). */
const priceToMinor = (text: string) =>
  Number(text.replace(/\s/g, "").replace("kr", "").replace(",", ".")) * 100;

test.describe("homepage", () => {
  test("shows database-backed sections without drafts or archived products", async ({
    page,
  }) => {
    await page.goto("/");
    const main = page.getByRole("main");

    for (const name of [
      "Utvalda produkter",
      "Kategorier",
      "Nyheter",
      "Kommande släpp",
    ]) {
      await expect(main.getByRole("region", { name })).toBeVisible();
    }
    await expect(
      main
        .getByRole("region", { name: "Utvalda produkter" })
        .getByRole("link", { name: "Destined Rivals Booster Box" }),
    ).toBeVisible();
    await expect(
      main.getByRole("region", { name: "Kategorier" }).getByRole("link", {
        name: /Booster Boxes/,
      }),
    ).toHaveAttribute("href", "/kategori/booster-boxes");
    await expect(main).not.toContainText("Mega Evolution Booster Box");
    await expect(main).not.toContainText("151 Booster Bundle");
  });

  test("shows the trust banner before the branded hero", async ({ page }) => {
    await page.goto("/");
    const main = page.getByRole("main");
    const trust = main.getByRole("region", { name: "Därför HeavyCards" });
    const hero = main.locator('[data-section="hero"]');

    for (const text of [
      "Förseglat och originalförpackat",
      "Skickas med PostNord",
      "Säker betalning",
    ]) {
      await expect(trust).toContainText(text);
    }
    // Document order: header → trust banner → hero → other sections.
    const order = await main.evaluate((el) =>
      [...el.children].map((child) => child.getAttribute("data-section")),
    );
    expect(order.slice(0, 2)).toEqual(["trygghet", "hero"]);

    // The h1 is still the first heading on the page.
    await expect(page.getByRole("heading").first()).toHaveText(
      "Förseglade Pokémon TCG-produkter",
    );

    // Brand label as text, mark as decorative only (no extra announcements).
    await expect(hero.getByText("HeavyCards", { exact: true })).toBeVisible();
    const marks = hero.locator(".brand-mark");
    await expect(marks.first()).toHaveAttribute("aria-hidden", "true");
    await expect(marks.filter({ visible: true })).toHaveCount(1);
  });
});

test.describe("Pokémon TCG landing page", () => {
  test("lists categories and every listable product, without a set list", async ({
    page,
  }) => {
    await page.goto("/pokemon-tcg");

    await expect(
      page.getByRole("heading", { level: 1, name: "Pokémon TCG" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Kategorier" }),
    ).toBeVisible();
    // Sets are reached through the filter and product pages instead.
    await expect(page.getByRole("region", { name: "Pokémon-set" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("main").locator('a[href^="/set/"]'),
    ).toHaveCount(0);
    await expect(page.getByText("11 produkter")).toBeVisible();
    const names = await cardNames(page);
    expect(names).toContain("Kommande set Booster Box");
    expect(names).not.toContain("Mega Evolution Booster Box");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      /\/pokemon-tcg$/,
    );
    await expectNoAxeViolations(page);
  });

  test("category tiles lead to a server-rendered category page", async ({
    page,
  }) => {
    await page.goto("/pokemon-tcg");
    await page
      .getByRole("region", { name: "Kategorier" })
      .getByRole("link", { name: /Booster Boxes/ })
      .click();

    await expect(page).toHaveURL("/kategori/booster-boxes");
    await expect(
      page.getByRole("heading", { level: 1, name: "Booster Boxes" }),
    ).toBeVisible();
    await expect(page.getByText("3 produkter")).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Brödsmulor" }),
    ).toContainText("Pokémon TCG");
    await expect(page).toHaveTitle(/Booster Boxes/);
  });

  test("the set filter remains and narrows the listing", async ({ page }) => {
    await page.goto("/pokemon-tcg");
    const filters = page.getByRole("form", { name: "Filtrera och sortera" });

    await filters
      .getByLabel("Set", { exact: true })
      .selectOption("destined-rivals");
    await filters.getByRole("button", { name: "Visa" }).click();

    await expect(page).toHaveURL(/set=destined-rivals/);
    expect((await cardNames(page)).sort()).toEqual([
      "Destined Rivals Booster Box",
      "Destined Rivals Booster Pack",
      "Destined Rivals Elite Trainer Box",
    ]);
  });

  test("set pages stay reachable through internal links", async ({ page }) => {
    await page.goto("/pokemon-tcg/destined-rivals-booster-box");
    await page
      .getByRole("main")
      .getByRole("link", { name: "Destined Rivals", exact: true })
      .first()
      .click();

    await expect(page).toHaveURL("/set/destined-rivals");
    await expect(
      page.getByRole("heading", { level: 1, name: "Destined Rivals" }),
    ).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Släpptes 30 maj 2025");
    expect((await cardNames(page)).sort()).toEqual([
      "Destined Rivals Booster Box",
      "Destined Rivals Booster Pack",
      "Destined Rivals Elite Trainer Box",
    ]);
  });
});

test.describe("filtering and sorting", () => {
  test("in-stock filter removes sold-out and coming-soon products", async ({
    page,
  }) => {
    await page.goto("/pokemon-tcg");
    const filters = page.getByRole("form", { name: "Filtrera och sortera" });

    await filters.getByLabel("Tillgänglighet").selectOption("i-lager");
    await filters.getByRole("button", { name: "Visa" }).click();

    await expect(page).toHaveURL(/tillganglighet=i-lager/);
    const names = await cardNames(page);
    expect(names).not.toContain("Prismatic Evolutions Elite Trainer Box");
    expect(names).not.toContain("Kommande set Booster Box");
    expect(names).toContain("Kommande set Elite Trainer Box"); // preorder
    // Filtered variants are kept out of the index.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
    await page.getByRole("link", { name: "Rensa filter" }).click();
    await expect(page).toHaveURL("/pokemon-tcg");
  });

  test("category filter narrows the listing", async ({ page }) => {
    await page.goto("/pokemon-tcg?kategori=tins");

    expect(await cardNames(page)).toEqual(["Surging Sparks Mini Tin"]);
    await expect(page.getByLabel("Kategori", { exact: true })).toHaveValue(
      "tins",
    );
  });

  test("sorts by price ascending and descending", async ({ page }) => {
    for (const [sort, direction] of [
      ["pris-stigande", 1],
      ["pris-fallande", -1],
    ] as const) {
      await page.goto(`/pokemon-tcg?sortering=${sort}`);
      const prices = (
        await page
          .getByRole("main")
          .getByRole("article")
          .locator("p.tabular-nums > span.font-semibold")
          .allTextContents()
      ).map(priceToMinor);

      expect(prices.length).toBe(11);
      expect(prices).toEqual([...prices].sort((a, b) => (a - b) * direction));
    }
  });

  test("invalid parameters degrade to the unfiltered listing", async ({
    page,
  }) => {
    const response = await page.goto(
      "/pokemon-tcg?kategori=finns-inte&sortering=billigast&sida=abc&tillganglighet=ja",
    );

    expect(response?.status()).toBe(200);
    await expect(page.getByText("11 produkter")).toBeVisible();
  });
});

test.describe("product page", () => {
  test("shows price, availability, reviews and structured data", async ({
    page,
  }) => {
    await page.goto("/pokemon-tcg/destined-rivals-elite-trainer-box");
    const main = page.getByRole("main");

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Destined Rivals Elite Trainer Box",
      }),
    ).toBeVisible();
    await expect(main.getByText("699 kr").first()).toBeVisible();
    await expect(main.getByText("Få kvar i lager")).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Brödsmulor" }),
    ).toContainText("Elite Trainer Boxes");

    // Purchasable: live quantity selector and add-to-cart (Milestone 5).
    await expect(
      main.getByRole("button", { name: "Lägg i kundvagn" }),
    ).toBeEnabled();
    await expect(main.getByRole("group", { name: "Antal" })).toBeVisible();

    const reviews = page.getByRole("region", { name: "Recensioner" });
    await expect(reviews).toContainText("Perfekt skick");
    await expect(reviews).toContainText("Verifierat köp");

    const jsonLd = await page
      .locator('script[type="application/ld+json"]')
      .first()
      .textContent();
    const [product] = JSON.parse(jsonLd ?? "[]");
    expect(product).toMatchObject({
      "@type": "Product",
      offers: { price: "699.00", priceCurrency: "SEK" },
      aggregateRating: { ratingValue: 5, reviewCount: 1 },
    });
    await expectNoAxeViolations(page);
  });

  test("never shows pending or rejected reviews", async ({ page }) => {
    await page.goto("/pokemon-tcg/destined-rivals-booster-pack");
    const reviews = page.getByRole("region", { name: "Recensioner" });
    await expect(reviews).toContainText("Inga recensioner ännu");
    await expect(page.getByRole("main")).not.toContainText("Roliga packs");

    await page.goto("/pokemon-tcg/toploaders-35pt-25-st");
    await expect(page.getByRole("main")).not.toContainText("avvisats");
  });

  test("sold-out products cannot be added", async ({ page }) => {
    await page.goto("/pokemon-tcg/prismatic-evolutions-elite-trainer-box");
    const main = page.getByRole("main");

    await expect(main.getByText("Slutsåld").first()).toBeVisible();
    await expect(main.getByRole("button", { name: "Slutsåld" })).toBeDisabled();
    await expect(
      main.getByRole("button", { name: "Lägg i kundvagn" }),
    ).toHaveCount(0);
  });

  test("coming-soon and preorder products are clearly distinguished", async ({
    page,
  }) => {
    await page.goto("/pokemon-tcg/kommande-set-booster-box");
    let main = page.getByRole("main");
    await expect(main.getByText("Kommer snart")).toBeVisible();
    await expect(
      main.getByText("Produkten går inte att beställa ännu."),
    ).toBeVisible();
    await expect(main.getByRole("button", { name: "Förbeställ" })).toHaveCount(
      0,
    );

    await page.goto("/pokemon-tcg/kommande-set-elite-trainer-box");
    main = page.getByRole("main");
    await expect(
      main.getByText(/Förbeställning: produkten skickas när/),
    ).toBeVisible();
    await expect(main.getByText(/^Släpps/).first()).toBeVisible();
  });

  test("archived products keep a noindex discontinued page", async ({
    page,
  }) => {
    const response = await page.goto(
      "/pokemon-tcg/scarlet-violet-151-booster-bundle",
    );

    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("main").getByText("Säljs inte längre", { exact: true }),
    ).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
  });
});

test.describe("unknown slugs return 404", () => {
  for (const path of [
    "/pokemon-tcg/finns-inte",
    "/pokemon-tcg/mega-evolution-booster-box", // DRAFT
    "/kategori/finns-inte",
    "/set/finns-inte",
    "/pokemon-tcg?sida=99",
  ]) {
    test(path, async ({ page }) => {
      const response = await page.goto(path);

      expect(response?.status()).toBe(404);
      await expect(
        page.getByRole("heading", { level: 1, name: "Sidan hittades inte" }),
      ).toBeVisible();
    });
  }
});

test.describe("Nyheter and Kommande", () => {
  test("Nyheter lists recently published products, not upcoming ones", async ({
    page,
  }) => {
    await page.goto("/nyheter");
    const names = await cardNames(page);

    expect(names).toContain("Destined Rivals Booster Box");
    expect(names).not.toContain("Kommande set Booster Box");
    expect(names).not.toContain("Toploaders 35pt (25 st)"); // 90 days old
  });

  test("Kommande separates preorder from coming soon", async ({ page }) => {
    await page.goto("/kommande");
    const card = (name: string) =>
      page.getByRole("main").getByRole("article").filter({ hasText: name });

    await expect(card("Kommande set Elite Trainer Box")).toContainText(
      "Förbeställ",
    );
    await expect(card("Kommande set Booster Box")).toContainText(
      "Kommer snart",
    );
    await expect(card("Kommande set Booster Box")).not.toContainText(
      "Förbeställ",
    );
    await expect(card("Kommande set Booster Box")).toContainText("Släpps");
  });
});

test.describe("search", () => {
  test("finds products from the header search", async ({ page }, testInfo) => {
    await page.goto("/");
    if (isMobile(testInfo.project.name)) {
      await page.getByRole("banner").getByRole("link", { name: "Sök" }).click();
      await page
        .getByRole("search", { name: "Sök i sortimentet" })
        .getByRole("searchbox")
        .fill("destined box");
      await page.keyboard.press("Enter");
    } else {
      const search = page
        .getByRole("banner")
        .getByRole("searchbox", { name: "Sök produkter" });
      await search.fill("destined box");
      await search.press("Enter");
    }

    await expect(page).toHaveURL(/\/sok\?q=destined\+box/);
    // Wait for results to replace the loading skeleton.
    await expect(page.getByText(/Resultat för/)).toBeVisible();
    await expect(page.getByRole("main").getByRole("article")).toHaveCount(2);
    expect((await cardNames(page)).sort()).toEqual([
      "Destined Rivals Booster Box",
      "Destined Rivals Elite Trainer Box",
    ]);
    await expect(page.getByLabel("Sortera", { exact: true })).toHaveValue(
      "relevans",
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
  });

  test("shows a helpful no-results state", async ({ page }) => {
    await page.goto("/sok?q=charizard");

    await expect(page.getByText("Inga träffar för ”charizard”")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Se hela sortimentet" }),
    ).toBeVisible();
  });

  test("handles an empty query", async ({ page }) => {
    const response = await page.goto("/sok");

    expect(response?.status()).toBe(200);
    await expect(page.getByText("Vad letar du efter?")).toBeVisible();
  });

  test("never returns drafts", async ({ page }) => {
    await page.goto("/sok?q=mega+evolution");

    await expect(page.getByText(/Inga träffar/)).toBeVisible();
  });
});

test.describe("responsive catalog", () => {
  test("uses two columns on phones and more on desktop", async ({
    page,
  }, testInfo) => {
    await page.goto("/pokemon-tcg");
    const cards = page.getByRole("main").getByRole("article");
    const boxes = await Promise.all(
      [0, 1, 2].map(async (index) => (await cards.nth(index).boundingBox())!),
    );

    // Same row for the first two cards on every layout.
    expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThan(2);
    const thirdOnSameRow = Math.abs(boxes[0]!.y - boxes[2]!.y) < 2;
    expect(thirdOnSameRow).toBe(!isMobile(testInfo.project.name));

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
