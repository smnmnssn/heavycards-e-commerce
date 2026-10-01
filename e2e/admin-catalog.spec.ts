import { devices, expect, test, type Page } from "@playwright/test";

import {
  expectNoAxeViolations,
  isolateClientIp,
  login,
  SEEDED_ADMIN,
  SEEDED_OWNER,
  seededPassword,
} from "./admin-helpers";
import {
  pngImage,
  removeE2eCatalogData,
  uniqueSuffix,
} from "./catalog-fixtures";

/*
 * Catalog administration (Milestone 7): products, inventory, images,
 * categories and Pokémon sets, and their effect on the public storefront.
 *
 * Runs in its own Playwright project after the storefront tests, because it
 * publishes products. Everything it creates uses an "E2E-"/"e2e-" prefix
 * and is removed before and after the run.
 */

test.beforeAll(removeE2eCatalogData);
test.afterAll(removeE2eCatalogData);

test.beforeEach(async ({ context }) => {
  await isolateClientIp(context);
});

/** Prices are formatted with non-breaking spaces ("1 499 kr"). */
const PRICE = (text: string) => new RegExp(text.replaceAll(" ", "\\s"));

async function signIn(page: Page, email = SEEDED_ADMIN) {
  await login(page, email, seededPassword());
  await expect(page).toHaveURL("/admin");
}

type CreatedProduct = { id: string; name: string; slug: string; sku: string };

/** Creates a product through the admin form and returns to its edit page. */
async function createProduct(
  page: Page,
  {
    status = "DRAFT",
    price = "1499",
    stock = "5",
    featured = false,
  }: {
    status?: "DRAFT" | "ACTIVE" | "COMING_SOON";
    price?: string;
    stock?: string;
    featured?: boolean;
  } = {},
): Promise<CreatedProduct> {
  const suffix = uniqueSuffix();
  const name = `E2E Testbox ${suffix}`;
  const sku = `E2E-${suffix}`.toUpperCase();
  await page.goto("/admin/products/new");
  await page.getByLabel("Produktnamn").fill(name);
  await page.getByLabel("Pris (kr)", { exact: true }).fill(price);
  await page.getByLabel("Artikelnummer (SKU)").fill(sku);
  await page.getByLabel("Lagersaldo (st)").fill(stock);
  await page
    .getByLabel("Pokémon-set")
    .selectOption({ label: "Destined Rivals" });
  await page.getByLabel("Status").selectOption(status);
  if (featured) await page.getByRole("checkbox", { name: /^Utvald/ }).check();
  await page.getByRole("button", { name: "Skapa produkt" }).click();

  await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}\?skapad=1$/);
  await expect(page.getByText("Produkten är skapad.")).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").pop()!;
  return { id, name, sku, slug: `e2e-testbox-${suffix}` };
}

async function save(page: Page) {
  await page.getByRole("button", { name: "Spara ändringar" }).click();
  await expect(page.getByText(/^Produkten är sparad\./)).toBeVisible();
}

test.describe("access control", () => {
  for (const path of [
    "/admin/products",
    "/admin/products/new",
    "/admin/categories",
    "/admin/sets/new",
  ]) {
    test(`${path} requires signing in`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(
        `/admin/login?next=${encodeURIComponent(path)}`,
      );
    });
  }

  test("the upload endpoint refuses anonymous requests", async ({
    request,
    baseURL,
  }) => {
    const response = await request.post(
      "/api/admin/products/01999999-0000-7000-8000-00000000000a/images",
      {
        headers: { Origin: baseURL! },
        multipart: {
          file: {
            name: "x.png",
            mimeType: "image/png",
            buffer: await pngImage(400, 400),
          },
        },
      },
    );
    expect(response.status()).toBe(401);
  });

  test("an OWNER can manage the catalog too", async ({ page }) => {
    await signIn(page, SEEDED_OWNER);
    await page
      .getByRole("navigation", { name: "Adminmeny" })
      .getByRole("link", { name: "Produkter" })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Produkter" }),
    ).toBeVisible();
  });
});

test.describe("product list", () => {
  test("shows prices, stock, status and filters", async ({ page }) => {
    await signIn(page);
    await page.goto("/admin/products");

    const rows = page.getByTestId("admin-product-row");
    const box = rows.filter({ hasText: "Destined Rivals Booster Box" });
    await expect(box).toBeVisible();
    await expect(box).toContainText("SV10-BB-EN");
    await expect(box).toContainText(/kr/);
    await expect(box).toContainText("Aktiv");
    await expect(box).toContainText("Booster Boxes");
    // Archived products are hidden unless asked for.
    await expect(rows.filter({ hasText: "Arkiverad" })).toHaveCount(0);

    await page.getByRole("searchbox", { name: "Sök" }).fill("destined");
    await page.getByRole("button", { name: "Filtrera" }).click();
    await expect(page).toHaveURL(/q=destined/);
    for (const name of await rows.allTextContents()) {
      expect(name.toLowerCase()).toContain("destined");
    }

    await page.goto("/admin/products?status=ARCHIVED");
    await expect(rows.first()).toContainText("Arkiverad");

    await page.goto("/admin/products?lager=slut&status=alla");
    await expect(rows.first()).toContainText("Slut");
    await expectNoAxeViolations(page);
  });

  test("works on a phone without horizontal scrolling", async ({ browser }) => {
    const context = await browser.newContext({ ...devices["Pixel 7"] });
    await isolateClientIp(context);
    const page = await context.newPage();
    await signIn(page);
    await page.goto("/admin/products");
    await expect(page.getByTestId("admin-product-row").first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await context.close();
  });
});

test.describe("product lifecycle", () => {
  test("validates on the client and on the server before creating", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/admin/products/new");

    await page.getByRole("button", { name: "Skapa produkt" }).click();
    await expect(
      page.getByText("Kontrollera de markerade fälten."),
    ).toBeVisible();
    await expect(page.getByLabel("Produktnamn")).toHaveAttribute(
      "aria-invalid",
      "true",
    );

    await page.getByLabel("Produktnamn").fill("E2E Valideringstest");
    await expect(page.getByLabel("URL-slug")).toHaveValue(
      "e2e-valideringstest",
    );
    await page.getByLabel("Pris (kr)", { exact: true }).fill("gratis");
    await page.getByLabel("Lagersaldo (st)").fill("-3");
    await page.getByRole("button", { name: "Skapa produkt" }).click();
    await expect(
      page.getByText("Ange priset i kronor, t.ex. 1499"),
    ).toBeVisible();
    await expect(
      page.getByText(/Ange lagersaldot som ett heltal/),
    ).toBeVisible();

    // A duplicate SKU passes the browser checks; the server rejects it.
    await page.getByLabel("Pris (kr)", { exact: true }).fill("100");
    await page.getByLabel("Lagersaldo (st)").fill("1");
    await page.getByLabel("Artikelnummer (SKU)").fill("SV10-BB-EN");
    await page.getByRole("button", { name: "Skapa produkt" }).click();
    await expect(
      page.getByText("Artikelnumret används redan av en annan produkt."),
    ).toBeVisible();
    await expect(page).toHaveURL("/admin/products/new");
  });

  test("create, edit price and stock, publish and see it in the store", async ({
    page,
  }) => {
    await signIn(page);
    const product = await createProduct(page);
    await expect(page.getByTestId("product-status")).toHaveText("Utkast");

    // Drafts are not public.
    const draft = await page.request.get(`/pokemon-tcg/${product.slug}`);
    expect(draft.status()).toBe(404);

    await page.goto(`/admin/products/${product.id}`);
    await page.getByLabel("Status").selectOption("ACTIVE");
    await save(page);
    await expect(page.getByTestId("product-status")).toHaveText("Aktiv");

    // The product page is cached (ISR); render it once.
    await page.goto(`/pokemon-tcg/${product.slug}`);
    await expect(
      page.getByRole("heading", { level: 1, name: product.name }),
    ).toBeVisible();
    await expect(page.getByRole("main")).toContainText(PRICE("1 499 kr"));

    await page.goto(`/admin/products/${product.id}`);
    await page.getByLabel("Pris (kr)", { exact: true }).fill("1299");
    await page.getByLabel("Jämförpris (valfritt, kr)").fill("1499");
    await page.getByLabel("Lagersaldo (st)").fill("0");
    await save(page);

    // Well within the 60-second ISR window: only revalidation explains this.
    await expect(async () => {
      await page.goto(`/pokemon-tcg/${product.slug}`);
      await expect(page.getByRole("main")).toContainText(PRICE("1 299 kr"));
      await expect(page.getByRole("main")).toContainText("Slutsåld");
    }).toPass({ timeout: 15_000 });
  });

  test("refuses a stock edit made on stale data", async ({ page, browser }) => {
    await signIn(page);
    const product = await createProduct(page, { stock: "10" });

    // A second administrator changes the stock meanwhile.
    const other = await browser.newContext();
    await isolateClientIp(other);
    const otherPage = await other.newPage();
    await signIn(otherPage, SEEDED_OWNER);
    await otherPage.goto(`/admin/products/${product.id}`);
    await otherPage.getByLabel("Lagersaldo (st)").fill("7");
    await otherPage.getByRole("button", { name: "Spara ändringar" }).click();
    await expect(otherPage.getByText("Produkten är sparad.")).toBeVisible();
    await other.close();

    await page.getByLabel("Lagersaldo (st)").fill("12");
    await page.getByRole("button", { name: "Spara ändringar" }).click();
    await expect(
      page.getByText(/Lagersaldot har ändrats till 7 sedan sidan laddades/),
    ).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Lagersaldo (st)")).toHaveValue("7");
    await page.getByLabel("Lagersaldo (st)").fill("12");
    await save(page);
    await expect(page.getByLabel("Lagersaldo (st)")).toHaveValue("12");
  });

  test("featured products appear on the cached homepage at once", async ({
    page,
  }) => {
    await signIn(page);
    const product = await createProduct(page, { status: "ACTIVE" });
    await page.goto("/");
    const featured = page.locator('[data-section="utvalda"]');
    await expect(featured).not.toContainText(product.name);

    await page.goto(`/admin/products/${product.id}`);
    await page.getByRole("checkbox", { name: /^Utvald/ }).check();
    await save(page);

    await expect(async () => {
      await page.goto("/");
      await expect(featured).toContainText(product.name);
    }).toPass({ timeout: 15_000 });
  });

  test("a slug change keeps the old URL working with a permanent redirect", async ({
    page,
  }) => {
    await signIn(page);
    const product = await createProduct(page, { status: "ACTIVE" });
    await page.goto(`/pokemon-tcg/${product.slug}`);

    await page.goto(`/admin/products/${product.id}`);
    const newSlug = `${product.slug}-ny`;
    await page.getByLabel("URL-slug").fill(newSlug);
    await expect(page.getByText(/leder den gamla adressen/)).toBeVisible();
    await page.getByRole("button", { name: "Spara ändringar" }).click();
    await expect(
      page.getByText(
        "Produkten är sparad. Den gamla adressen leder nu permanent till den nya.",
      ),
    ).toBeVisible();

    const response = await page.goto(`/pokemon-tcg/${product.slug}`);
    expect(response?.request().redirectedFrom()).toBeTruthy();
    expect(
      (await response!.request().redirectedFrom()!.response())!.status(),
    ).toBe(308);
    await expect(page).toHaveURL(`/pokemon-tcg/${newSlug}`);
  });

  test("archiving removes a product from listings but keeps its page", async ({
    page,
  }) => {
    await signIn(page);
    const product = await createProduct(page, { status: "ACTIVE" });
    await page.goto(`/sok?q=${encodeURIComponent(product.name)}`);
    await expect(page.getByRole("main").getByRole("article")).toHaveCount(1);

    await page.goto(`/admin/products/${product.id}`);
    await page.getByLabel("Status").selectOption("ARCHIVED");
    await expect(
      page.getByText(/Arkiverade produkter går inte att köpa/),
    ).toBeVisible();
    await save(page);
    await expect(page.getByTestId("product-status")).toHaveText("Arkiverad");
    // Published products cannot be deleted, only archived.
    await expect(
      page.getByRole("button", { name: "Radera produkt" }),
    ).toHaveCount(0);

    await page.goto(`/sok?q=${encodeURIComponent(product.name)}`);
    await expect(page.getByRole("main").getByRole("article")).toHaveCount(0);
    await expect(async () => {
      await page.goto(`/pokemon-tcg/${product.slug}`);
      await expect(page.getByRole("main")).toContainText("Säljs inte längre");
    }).toPass({ timeout: 15_000 });
  });

  test("a never-published draft can be deleted; products with history cannot", async ({
    page,
  }) => {
    await signIn(page);
    const product = await createProduct(page);
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Radera produkt" }).click();
    await expect(page).toHaveURL("/admin/products?raderad=1");
    await expect(page.getByText("Produkten är raderad.")).toBeVisible();
    await page.goto(`/admin/products?status=alla&q=${product.sku}`);
    await expect(page.getByTestId("admin-product-row")).toHaveCount(0);

    // Seeded product with paid orders: archive only.
    await page.goto("/admin/products?q=SV10-ETB-EN");
    await page
      .getByRole("link", { name: "Destined Rivals Elite Trainer Box" })
      .click();
    await expect(page.getByText(/Produkten kan inte raderas/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Radera produkt" }),
    ).toHaveCount(0);
  });

  test("warns about a preorder whose release date has passed", async ({
    page,
  }) => {
    await signIn(page);
    const product = await createProduct(page, { status: "ACTIVE" });
    await page.getByRole("checkbox", { name: /^Förbeställning/ }).check();
    await page.getByLabel("Släppdatum (valfritt)").fill("2024-01-01");
    await expect(
      page.getByText(/Släppdatumet har passerat men produkten/),
    ).toBeVisible();
    await save(page);

    await page.reload();
    await expect(page.getByTestId("product-warnings")).toContainText(
      "fortfarande markerad som förbeställning",
    );
    // Nothing is changed automatically.
    await expect(
      page.getByRole("checkbox", { name: /^Förbeställning/ }),
    ).toBeChecked();
    await page.goto(`/admin/products?q=${product.sku}`);
    await expect(page.getByTestId("admin-product-row")).toContainText(
      "Släppdatum passerat",
    );
  });
});

test.describe("product images", () => {
  test("upload, validate, reorder, describe and remove images", async ({
    page,
  }) => {
    await signIn(page);
    const product = await createProduct(page, { status: "ACTIVE" });
    const upload = page.getByLabel("Ladda upp bilder");
    const images = page.getByTestId("product-image");

    await upload.setInputFiles({
      name: "forsta.png",
      mimeType: "image/png",
      buffer: await pngImage(900, 900),
    });
    await expect(page.getByText("Bilden är uppladdad.")).toBeVisible();
    await expect(images).toHaveCount(1);
    await expect(images.first()).toContainText("Bild 1 · Huvudbild");

    // Not an image, despite its name and declared type: refused by the server.
    await upload.setInputFiles({
      name: "fejk.png",
      mimeType: "image/png",
      buffer: Buffer.from("detta är ingen bild"),
    });
    await expect(
      page.getByText(/inte en JPEG-, PNG- eller WebP-bild/),
    ).toBeVisible();
    // SVG is refused before uploading.
    await upload.setInputFiles({
      name: "logo.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    });
    await expect(page.getByText(/endast JPEG, PNG och WebP/)).toBeVisible();
    await expect(images).toHaveCount(1);

    await upload.setInputFiles({
      name: "andra.png",
      mimeType: "image/png",
      buffer: await pngImage(1200, 800, "#b0b0b0"),
    });
    await expect(images).toHaveCount(2);
    await expect(images.nth(1)).toContainText("1200×800");

    await page.getByRole("button", { name: "Flytta bild 2 uppåt" }).click();
    await expect(page.getByText("Bildordningen är sparad.")).toBeVisible();
    await expect(images.first()).toContainText("1200×800");
    await expect(images.first()).toContainText("Huvudbild");

    await page.getByLabel("Alt-text för bild 1").fill("E2E-box framifrån");
    await images
      .first()
      .getByRole("button", { name: "Spara alt-text" })
      .click();
    await expect(page.getByText("Alt-texten är sparad.")).toBeVisible();

    // The storefront shows the new primary image with its alt text.
    await expect(async () => {
      await page.goto(`/pokemon-tcg/${product.slug}`);
      const image = page.getByRole("main").getByRole("img", {
        name: "E2E-box framifrån",
      });
      await expect(image.first()).toBeVisible();
      expect(
        await image
          .first()
          .evaluate((node: HTMLImageElement) => node.naturalWidth),
      ).toBeGreaterThan(0);
    }).toPass({ timeout: 15_000 });

    await page.goto(`/admin/products/${product.id}`);
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Ta bort bild 2" }).click();
    await expect(page.getByText("Bilden är borttagen.")).toBeVisible();
    await expect(images).toHaveCount(1);
    await expectNoAxeViolations(page);
  });
});

test.describe("categories and Pokémon sets", () => {
  test("create, rename (with redirect) and delete a category", async ({
    page,
  }) => {
    await signIn(page, SEEDED_OWNER);
    const suffix = uniqueSuffix();
    const name = `E2E Kategori ${suffix}`;
    const slug = `e2e-kategori-${suffix}`;

    await page.goto("/admin/categories/new");
    await page.getByLabel("Namn", { exact: true }).fill(name);
    await expect(page.getByLabel("URL-slug")).toHaveValue(slug);
    await page.getByLabel("Sorteringsordning").fill("99");
    await page.getByRole("button", { name: "Skapa kategori" }).click();
    await expect(page.getByText("Kategorin är skapad.")).toBeVisible();

    const publicPage = await page.request.get(`/kategori/${slug}`);
    expect(publicPage.status()).toBe(200);

    await page.getByLabel("URL-slug").fill(`${slug}-ny`);
    await page.getByLabel("Beskrivning (valfri)").fill("Beskrivning från E2E.");
    await page.getByRole("button", { name: "Spara ändringar" }).click();
    await expect(
      page.getByText(
        "Kategorin är sparad. Den gamla adressen leder nu permanent till den nya.",
      ),
    ).toBeVisible();
    await page.goto(`/kategori/${slug}`);
    await expect(page).toHaveURL(`/kategori/${slug}-ny`);
    await expect(page.getByRole("main")).toContainText("Beskrivning från E2E.");

    await page.goto("/admin/categories");
    await page.getByRole("link", { name }).click();
    await expectNoAxeViolations(page);
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Ta bort kategorin" }).click();
    await expect(page).toHaveURL("/admin/categories?raderad=1");
    await page.goto(`/kategori/${slug}-ny`);
    await expect(page).toHaveURL("/pokemon-tcg");
  });

  test("a category in use cannot be deleted", async ({ page }) => {
    await signIn(page);
    await page.goto("/admin/categories");
    const row = page
      .getByTestId("taxonomy-row")
      .filter({ hasText: "Booster Boxes" });
    await expect(row).toContainText(/\d+ produkter/);
    await row.getByRole("link", { name: "Booster Boxes" }).click();
    await expect(page.getByText(/och kan därför inte tas bort/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Ta bort kategorin" }),
    ).toHaveCount(0);
  });

  test("create, edit and delete a Pokémon set", async ({ page }) => {
    await signIn(page);
    const suffix = uniqueSuffix();
    const name = `E2E Set ${suffix}`;
    const slug = `e2e-set-${suffix}`;

    await page.goto("/admin/sets/new");
    await page.getByLabel("Namn", { exact: true }).fill(name);
    await page.getByLabel("Släppdatum (valfritt)").fill("2025-05-30");
    await page.getByLabel("SEO-titel").fill(`${name} – köp hos HeavyCards`);
    await page.getByRole("button", { name: "Skapa set" }).click();
    await expect(page.getByText("Setet är skapat.")).toBeVisible();

    await page.goto(`/set/${slug}`);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("30 maj 2025");
    await expect(page).toHaveTitle(new RegExp(`${name} – köp hos HeavyCards`));

    await page.goto("/admin/sets");
    await page.getByRole("link", { name }).click();
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Ta bort setet" }).click();
    await expect(page).toHaveURL("/admin/sets?raderad=1");
  });
});
