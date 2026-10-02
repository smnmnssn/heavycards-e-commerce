import { expect, test, type Page } from "@playwright/test";

/*
 * SEO output in the browser against the seeded catalog (Milestone 13): meta
 * tags, canonicals, structured data, sitemap, robots and redirects. Read-only.
 *
 * The E2E server runs a local production build, which is *not* the Vercel
 * production deployment: robots.txt and X-Robots-Tag therefore show the
 * preview protection. Production robots output is covered by unit tests.
 */

const canonical = (page: Page) =>
  page.locator('link[rel="canonical"]').getAttribute("href");
const robots = (page: Page) => page.locator('meta[name="robots"]');
const meta = (page: Page, property: string) =>
  page.locator(`meta[property="${property}"]`).getAttribute("content");

async function jsonLd(page: Page): Promise<Array<Record<string, unknown>>> {
  const scripts = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents();
  return scripts.flatMap((text) => {
    const data = JSON.parse(text) as unknown;
    return (Array.isArray(data) ? data : [data]) as Array<
      Record<string, unknown>
    >;
  });
}

const ofType = (nodes: Array<Record<string, unknown>>, type: string) =>
  nodes.filter((node) => node["@type"] === type);

test.describe("preview protection (non-production build)", () => {
  test("robots.txt disallows all crawling outside Vercel production", async ({
    request,
  }) => {
    const response = await request.get("/robots.txt");

    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toMatch(/User-Agent: \*/i);
    expect(body).toMatch(/Disallow: \/\s*$/m);
    expect(body).not.toMatch(/^Allow:/m);
  });

  test("every storefront response carries noindex outside Vercel production", async ({
    request,
  }) => {
    for (const path of [
      "/",
      "/pokemon-tcg",
      "/pokemon-tcg/destined-rivals-booster-box",
      "/sitemap.xml",
    ]) {
      const response = await request.get(path);
      expect(response.headers()["x-robots-tag"], path).toBe(
        "noindex, nofollow",
      );
    }
  });
});

test.describe("sitemap.xml", () => {
  test("lists canonical public URLs only", async ({ request }) => {
    const response = await request.get("/sitemap.xml");

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("xml");
    const xml = await response.text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (match) => new URL(match[1]!).pathname,
    );

    for (const path of [
      "/",
      "/pokemon-tcg",
      "/nyheter",
      "/kommande",
      "/kategori/booster-boxes",
      "/set/destined-rivals",
      "/pokemon-tcg/destined-rivals-booster-box",
      "/pokemon-tcg/kommande-set-booster-box",
      "/pokemon-tcg/prismatic-evolutions-elite-trainer-box",
    ]) {
      expect(locs, path).toContain(path);
    }
    for (const path of [
      "/pokemon-tcg/mega-evolution-booster-box", // DRAFT
      "/pokemon-tcg/scarlet-violet-151-booster-bundle", // ARCHIVED
      "/pokemon-tcg/destined-rivals-bb", // redirect source
      "/set/scarlet-violet-151", // no listable products
      "/set/mega-evolution",
      "/om-oss", // noindex placeholder
    ]) {
      expect(locs, path).not.toContain(path);
    }
    for (const path of locs) {
      expect(path).not.toMatch(/^\/(admin|api|kassa|review|sok)(\/|$)/);
    }
    // No filtered, sorted, paginated or tracking variants.
    for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      expect(new URL(match[1]!).search).toBe("");
    }
  });
});

test.describe("metadata and canonicals", () => {
  test("homepage: Swedish metadata, Open Graph and store identity", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute("lang", "sv");
    await expect(page).toHaveTitle("HeavyCards – Pokémon TCG i Sverige");
    // The site root (Next.js writes it without the trailing slash).
    expect(new URL((await canonical(page))!).pathname).toBe("/");
    await expect(robots(page)).toHaveCount(0);
    expect(await meta(page, "og:locale")).toBe("sv_SE");
    expect(await meta(page, "og:site_name")).toBe("HeavyCards");
    expect(await meta(page, "og:image")).toMatch(
      /\/brand\/heavycards-share\.png$/,
    );

    const nodes = await jsonLd(page);
    expect(ofType(nodes, "Organization")[0]).toMatchObject({
      name: "HeavyCards",
      logo: expect.stringMatching(/\/brand\/heavycards-logo\.png$/),
    });
    expect(ofType(nodes, "WebSite")[0]).toMatchObject({
      inLanguage: "sv-SE",
    });
  });

  test("product page: canonical slug, product image for sharing", async ({
    page,
  }) => {
    await page.goto(
      "/pokemon-tcg/destined-rivals-booster-box?utm_source=nyhetsbrev&gclid=x",
    );

    await expect(page).toHaveTitle("Destined Rivals Booster Box | HeavyCards");
    expect(await canonical(page)).toMatch(
      /\/pokemon-tcg\/destined-rivals-booster-box$/,
    );
    await expect(robots(page)).toHaveCount(0);
    expect(
      await page.locator('meta[name="description"]').getAttribute("content"),
    ).toBeTruthy();
    expect(await meta(page, "og:url")).toMatch(
      /\/pokemon-tcg\/destined-rivals-booster-box$/,
    );
    expect(await meta(page, "og:image")).not.toMatch(/heavycards-share/);
  });

  test("filtered and sorted listings point at the unfiltered page", async ({
    page,
  }) => {
    await page.goto("/kategori/booster-boxes?sortering=pris-stigande");

    expect(await canonical(page)).toMatch(/\/kategori\/booster-boxes$/);
    await expect(robots(page)).toHaveAttribute("content", "noindex, follow");
    expect(ofType(await jsonLd(page), "CollectionPage")).toHaveLength(0);

    await page.goto("/kategori/booster-boxes?utm_campaign=host");
    expect(await canonical(page)).toMatch(/\/kategori\/booster-boxes$/);
    await expect(robots(page)).toHaveCount(0);
  });

  test("category landing page: metadata, breadcrumbs and collection data", async ({
    page,
  }) => {
    await page.goto("/kategori/booster-boxes");

    await expect(page).toHaveTitle("Booster Boxes – Pokémon TCG | HeavyCards");
    await expect(robots(page)).toHaveCount(0);
    const nodes = await jsonLd(page);
    expect(ofType(nodes, "BreadcrumbList")[0]).toMatchObject({
      itemListElement: [
        { position: 1, name: "Hem" },
        { position: 2, name: "Pokémon TCG" },
        { position: 3, name: "Booster Boxes" },
      ],
    });
    const collection = ofType(nodes, "CollectionPage")[0] as {
      mainEntity: { numberOfItems: number; itemListElement: unknown[] };
    };
    const cards = await page.getByRole("main").getByRole("article").count();
    expect(collection.mainEntity.numberOfItems).toBe(cards);
    expect(collection.mainEntity.itemListElement).toHaveLength(cards);
  });

  test("a set without listable products stays reachable but unindexed", async ({
    page,
  }) => {
    const response = await page.goto("/set/scarlet-violet-151");

    expect(response?.status()).toBe(200);
    await expect(robots(page)).toHaveAttribute("content", "noindex, follow");
    expect(await canonical(page)).toMatch(/\/set\/scarlet-violet-151$/);
  });

  test("search results and unknown pages are never index targets", async ({
    page,
  }) => {
    await page.goto("/sok?q=booster");
    await expect(robots(page)).toHaveAttribute("content", "noindex, follow");
    expect(await canonical(page)).toMatch(/\/sok$/);

    const missing = await page.goto("/pokemon-tcg/finns-inte");
    expect(missing?.status()).toBe(404);
    // Next.js adds its own noindex to error responses besides the page's.
    await expect(robots(page).first()).toHaveAttribute("content", /noindex/);

    const beyond = await page.goto("/kategori/booster-boxes?sida=40");
    expect(beyond?.status()).toBe(404);
  });
});

test.describe("structured data", () => {
  test("product JSON-LD matches the visible page", async ({ page }) => {
    await page.goto("/pokemon-tcg/destined-rivals-elite-trainer-box");
    const nodes = await jsonLd(page);
    const product = ofType(nodes, "Product")[0]!;

    expect(product).toMatchObject({
      name: "Destined Rivals Elite Trainer Box",
      "@id": expect.stringMatching(
        /\/pokemon-tcg\/destined-rivals-elite-trainer-box#product$/,
      ),
      sku: expect.any(String),
      category: "Elite Trainer Boxes",
      offers: {
        "@type": "Offer",
        price: "699.00",
        priceCurrency: "SEK",
        availability: "https://schema.org/LimitedAvailability",
        itemCondition: "https://schema.org/NewCondition",
      },
      aggregateRating: { ratingValue: 5, reviewCount: 1 },
    });
    expect(product).not.toHaveProperty("brand");
    expect(product).not.toHaveProperty("gtin");
    // Same price and rating as shown to the customer.
    const main = page.getByRole("main");
    await expect(main.getByText("699 kr").first()).toBeVisible();
    await expect(main.getByText("Få kvar i lager")).toBeVisible();

    const breadcrumbs = ofType(nodes, "BreadcrumbList")[0] as {
      itemListElement: Array<{ name: string; item?: string }>;
    };
    expect(breadcrumbs.itemListElement.map((item) => item.name)).toEqual([
      "Hem",
      "Pokémon TCG",
      "Elite Trainer Boxes",
      "Destined Rivals Elite Trainer Box",
    ]);
    expect(breadcrumbs.itemListElement[2]?.item).toMatch(
      /\/kategori\/elite-trainer-boxes$/,
    );
    await expect(
      page.getByRole("navigation", { name: "Brödsmulor" }).getByRole("link"),
    ).toHaveText(["Hem", "Pokémon TCG", "Elite Trainer Boxes"]);
  });

  test("no rating is claimed without approved reviews", async ({ page }) => {
    // Seeded with a pending and a rejected review only.
    await page.goto("/pokemon-tcg/destined-rivals-booster-pack");
    const product = ofType(await jsonLd(page), "Product")[0]!;

    expect(product).not.toHaveProperty("aggregateRating");
    expect(product).not.toHaveProperty("review");
  });

  test("coming-soon products make no offer; archived pages have no structured data", async ({
    page,
  }) => {
    await page.goto("/pokemon-tcg/kommande-set-booster-box");
    expect(ofType(await jsonLd(page), "Product")[0]).not.toHaveProperty(
      "offers",
    );

    await page.goto("/pokemon-tcg/scarlet-violet-151-booster-bundle");
    await expect(robots(page)).toHaveAttribute("content", "noindex, follow");
    expect(await jsonLd(page)).toEqual([]);
  });
});

test.describe("redirects", () => {
  test("an old product slug answers with a permanent redirect to the canonical URL", async ({
    request,
  }) => {
    const response = await request.get("/pokemon-tcg/destined-rivals-bb", {
      maxRedirects: 0,
    });

    expect(response.status()).toBe(308);
    // Next.js 16.3 repeats the identical Location header on the first,
    // uncached render of a redirecting ISR page (cached responses send it
    // once); every value must be the canonical target.
    const locations = response.headers()["location"]!.split(/,\s*/);
    expect(new Set(locations)).toEqual(
      new Set(["/pokemon-tcg/destined-rivals-booster-box"]),
    );
  });
});

test.describe("images", () => {
  test("the main product image loads first with its intrinsic size", async ({
    page,
  }) => {
    await page.goto("/pokemon-tcg/destined-rivals-booster-box");
    const image = page
      .getByRole("main")
      .getByRole("img", { name: "Destined Rivals Booster Box" })
      .first();

    await expect(image).toHaveAttribute("loading", "eager");
    await expect(image).toHaveAttribute("fetchpriority", "high");
    await expect(image).toHaveAttribute("width", /\d+/);
    await expect(image).toHaveAttribute("height", /\d+/);
  });
});
