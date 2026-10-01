import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib/auth/authorization";
import { createMemoryStorage } from "@/lib/storage/memory";
import { productImageKey } from "@/lib/storage/keys";
import type { ProductFormValues } from "@/lib/validation/catalog";
import { parseAdminProductParams } from "@/server/admin/catalog/product-list-params";
import {
  createProduct,
  deleteProduct,
  updateProduct,
} from "@/server/admin/catalog/products";
import { listAdminProducts } from "@/server/admin/catalog/queries";
import { findRedirectDestination } from "@/server/catalog/redirects";
import { getProductBySlug, listProducts } from "@/server/data/catalog-queries";

import { createAdmin } from "./auth-helpers";
import {
  createCategory,
  createPaidOrderWithItem,
  createPendingOrder,
  createProduct as createProductRow,
} from "./factories";
import { createTestDb, resetDatabase } from "./test-database";

const db = createTestDb();

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

const NOW = new Date("2026-10-01T10:00:00Z");

async function setup() {
  const owner = await createAdmin(db, { role: "OWNER" });
  const admin = await createAdmin(db, { role: "ADMIN" });
  const category = await createCategory(db, { name: "Booster Boxes" });
  const set = await db.pokemonSet.create({
    data: { name: "Destined Rivals", slug: "destined-rivals" },
  });
  const form = (overrides: Partial<ProductFormValues> = {}) =>
    ({
      name: "Destined Rivals Booster Box",
      slug: "destined-rivals-booster-box",
      shortDescription: "",
      description: "",
      productType: "SEALED",
      categoryId: category.id,
      pokemonSetId: set.id,
      price: "1499",
      compareAtPrice: "",
      sku: "sv10-bb-en",
      stockOnHand: "10",
      status: "DRAFT",
      isPreorder: false,
      isFeatured: false,
      releaseDate: "",
      seoTitle: "",
      seoDescription: "",
      ...overrides,
    }) satisfies ProductFormValues;
  return { owner, admin, category, set, form };
}

const auditActions = async (entityId: string) =>
  (
    await db.auditLog.findMany({
      where: { entityId },
      orderBy: { createdAt: "asc" },
    })
  ).map((entry) => ({
    action: entry.action,
    adminUserId: entry.adminUserId,
    metadata: entry.metadata,
  }));

async function created(
  result: Awaited<ReturnType<typeof createProduct>>,
): Promise<string> {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.productId;
}

describe("createProduct", () => {
  it.each(["OWNER", "ADMIN"] as const)(
    "lets an %s create a product, with an audit entry",
    async (role) => {
      const { owner, admin, form } = await setup();
      const actor = role === "OWNER" ? owner : admin;

      const id = await created(
        await createProduct(db, { actorId: actor.id, input: form(), now: NOW }),
      );

      const product = await db.product.findUniqueOrThrow({ where: { id } });
      expect(product).toMatchObject({
        name: "Destined Rivals Booster Box",
        sku: "SV10-BB-EN",
        priceAmount: 149_900,
        stockOnHand: 10,
        status: "DRAFT",
        publishedAt: null,
      });
      expect(await auditActions(id)).toEqual([
        {
          action: "CREATE_PRODUCT",
          adminUserId: actor.id,
          metadata: expect.objectContaining({
            sku: "SV10-BB-EN",
            priceAmount: 149_900,
            stockOnHand: 10,
          }),
        },
      ]);
    },
  );

  it("records the publication time when created as ACTIVE", async () => {
    const { admin, form } = await setup();
    const id = await created(
      await createProduct(db, {
        actorId: admin.id,
        input: form({ status: "ACTIVE" }),
        now: NOW,
      }),
    );
    expect(
      (await db.product.findUniqueOrThrow({ where: { id } })).publishedAt,
    ).toEqual(NOW);
  });

  it("returns field errors and writes nothing for invalid input", async () => {
    const { admin, form } = await setup();

    const result = await createProduct(db, {
      actorId: admin.id,
      input: form({ name: "", price: "gratis", stockOnHand: "-2" }),
    });

    expect(result).toEqual({
      ok: false,
      error: "INVALID_INPUT",
      fieldErrors: {
        name: expect.any(String),
        price: expect.any(String),
        stockOnHand: expect.any(String),
      },
    });
    expect(await db.product.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
  });

  it("reports duplicate slugs and SKUs (case-insensitively) on their fields", async () => {
    const { admin, form } = await setup();
    await created(
      await createProduct(db, { actorId: admin.id, input: form() }),
    );

    const result = await createProduct(db, {
      actorId: admin.id,
      input: form({ sku: "SV10-BB-EN" }),
    });

    expect(result).toMatchObject({
      ok: false,
      fieldErrors: {
        slug: expect.stringMatching(/används redan/),
        sku: expect.stringMatching(/används redan/),
      },
    });
    expect(await db.product.count()).toBe(1);
  });

  it("rejects a category that does not exist", async () => {
    const { admin, form } = await setup();
    const result = await createProduct(db, {
      actorId: admin.id,
      input: form({ categoryId: "01999999-0000-7000-8000-0000000000ff" }),
    });
    expect(result).toMatchObject({
      ok: false,
      fieldErrors: { categoryId: expect.any(String) },
    });
  });

  it("refuses inactive and unknown administrators", async () => {
    const { form } = await setup();
    const inactive = await createAdmin(db, { isActive: false });

    await expect(
      createProduct(db, { actorId: inactive.id, input: form() }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      createProduct(db, {
        actorId: "01999999-0000-7000-8000-0000000000ee",
        input: form(),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.product.count()).toBe(0);
  });
});

describe("updateProduct", () => {
  async function existing(overrides: Partial<ProductFormValues> = {}) {
    const context = await setup();
    const id = await created(
      await createProduct(db, {
        actorId: context.admin.id,
        input: context.form(overrides),
        now: new Date("2026-01-01T00:00:00Z"),
      }),
    );
    await db.auditLog.deleteMany();
    return { ...context, id };
  }

  it("changes price and stock and audits old and new values", async () => {
    const { admin, form, id } = await existing({ status: "ACTIVE" });

    const result = await updateProduct(db, {
      actorId: admin.id,
      productId: id,
      input: form({
        status: "ACTIVE",
        price: "1299,50",
        compareAtPrice: "1499",
        stockOnHand: "7",
      }),
      expectedStockOnHand: 10,
    });

    expect(result).toMatchObject({ ok: true, redirectCreated: false });
    expect(await db.product.findUniqueOrThrow({ where: { id } })).toMatchObject(
      { priceAmount: 129_950, compareAtPriceAmount: 149_900, stockOnHand: 7 },
    );
    expect(await auditActions(id)).toEqual([
      {
        action: "UPDATE_PRODUCT_PRICE",
        adminUserId: admin.id,
        metadata: {
          sku: "SV10-BB-EN",
          priceAmount: { from: 149_900, to: 129_950 },
          compareAtPriceAmount: { from: null, to: 149_900 },
        },
      },
      {
        action: "UPDATE_PRODUCT_STOCK",
        adminUserId: admin.id,
        metadata: { sku: "SV10-BB-EN", stockOnHand: { from: 10, to: 7 } },
      },
    ]);
  });

  it("refuses a stock edit based on a stale value instead of overwriting it", async () => {
    const { admin, form, id } = await existing();
    // Someone else (or a sale) changed the stock after the form was loaded.
    await db.product.update({ where: { id }, data: { stockOnHand: 8 } });

    const conflict = await updateProduct(db, {
      actorId: admin.id,
      productId: id,
      input: form({ stockOnHand: "15" }),
      expectedStockOnHand: 10,
    });
    expect(conflict).toEqual({
      ok: false,
      error: "STOCK_CONFLICT",
      currentStock: 8,
    });
    expect(
      (await db.product.findUniqueOrThrow({ where: { id } })).stockOnHand,
    ).toBe(8);

    // Saving other fields with the untouched stale value fails the same way,
    // so the newer stock is never silently reverted.
    expect(
      await updateProduct(db, {
        actorId: admin.id,
        productId: id,
        input: form({ name: "Nytt namn", stockOnHand: "10" }),
        expectedStockOnHand: 10,
      }),
    ).toMatchObject({ error: "STOCK_CONFLICT" });

    // With the current value the edit goes through.
    expect(
      await updateProduct(db, {
        actorId: admin.id,
        productId: id,
        input: form({ name: "Nytt namn", stockOnHand: "8" }),
        expectedStockOnHand: 8,
      }),
    ).toMatchObject({ ok: true });
    expect(
      (await db.product.findUniqueOrThrow({ where: { id } })).stockOnHand,
    ).toBe(8);
  });

  it("rejects negative and fractional stock server-side", async () => {
    const { admin, form, id } = await existing();
    for (const stockOnHand of ["-1", "2.5"]) {
      expect(
        await updateProduct(db, {
          actorId: admin.id,
          productId: id,
          input: form({ stockOnHand }),
          expectedStockOnHand: 10,
        }),
      ).toMatchObject({ error: "INVALID_INPUT" });
    }
  });

  it("publishes, archives and returns to draft, keeping the first publication time", async () => {
    const { admin, form, id } = await existing();
    const save = (status: ProductFormValues["status"], now: Date) =>
      updateProduct(db, {
        actorId: admin.id,
        productId: id,
        input: form({ status }),
        expectedStockOnHand: 10,
        now,
      });
    const publishedAt = () =>
      db.product
        .findUniqueOrThrow({ where: { id } })
        .then((product) => product.publishedAt);

    await save("ACTIVE", NOW);
    expect(await publishedAt()).toEqual(NOW);
    expect(
      (
        await listProducts(db, {
          sort: "newest",
          page: 1,
          pageSize: 10,
          now: NOW,
        })
      ).total,
    ).toBe(1);

    await save("ARCHIVED", new Date("2026-10-02T00:00:00Z"));
    expect(await publishedAt()).toEqual(NOW);
    expect(
      (
        await listProducts(db, {
          sort: "newest",
          page: 1,
          pageSize: 10,
          now: NOW,
        })
      ).total,
    ).toBe(0);
    // The archived page stays reachable (noindex) for old links.
    expect(
      await getProductBySlug(db, "destined-rivals-booster-box", NOW),
    ).toMatchObject({ status: "ARCHIVED" });

    await save("DRAFT", new Date("2026-10-03T00:00:00Z"));
    expect(await publishedAt()).toEqual(NOW);
    expect(
      await getProductBySlug(db, "destined-rivals-booster-box", NOW),
    ).toBeNull();

    expect((await auditActions(id)).map((entry) => entry.action)).toEqual([
      "PUBLISH_PRODUCT",
      "ARCHIVE_PRODUCT",
      "UPDATE_PRODUCT_STATUS",
    ]);
  });

  it("is reflected by the storefront queries immediately", async () => {
    const { admin, form, id } = await existing({ status: "ACTIVE" });
    await updateProduct(db, {
      actorId: admin.id,
      productId: id,
      input: form({ status: "ACTIVE", price: "999", isFeatured: true }),
      expectedStockOnHand: 10,
    });

    expect(
      await getProductBySlug(db, "destined-rivals-booster-box", NOW),
    ).toMatchObject({ priceAmount: 99_900 });
    const featured = await listProducts(db, {
      scope: "featured",
      sort: "newest",
      page: 1,
      pageSize: 4,
      now: NOW,
    });
    expect(featured.items.map((item) => item.priceAmount)).toEqual([99_900]);
  });

  it("keeps reservation-aware availability after a stock edit", async () => {
    const { admin, form, id } = await existing({ status: "ACTIVE" });
    const order = await createPendingOrder(db);
    await db.inventoryReservation.create({
      data: {
        orderId: order.id,
        productId: id,
        quantity: 2,
        expiresAt: new Date(NOW.getTime() + 30 * 60_000),
      },
    });

    await updateProduct(db, {
      actorId: admin.id,
      productId: id,
      input: form({ status: "ACTIVE", stockOnHand: "5" }),
      expectedStockOnHand: 10,
    });

    expect(
      await getProductBySlug(db, "destined-rivals-booster-box", NOW),
    ).toMatchObject({ availableQuantity: 3 });
    const list = await listAdminProducts(db, {
      params: parseAdminProductParams({ lager: "lagt" }),
      lowStockThreshold: 3,
      now: NOW,
    });
    expect(list.rows).toEqual([
      expect.objectContaining({
        id,
        stockOnHand: 5,
        reservedQuantity: 2,
        availableQuantity: 3,
      }),
    ]);
  });

  it("returns NOT_FOUND for unknown or malformed ids", async () => {
    const { admin, form } = await setup();
    for (const productId of ["01999999-0000-7000-8000-0000000000aa", "x"]) {
      expect(
        await updateProduct(db, {
          actorId: admin.id,
          productId,
          input: form(),
          expectedStockOnHand: 0,
        }),
      ).toEqual({ ok: false, error: "NOT_FOUND" });
    }
  });
});

describe("slug changes and redirects", () => {
  async function published(slug: string) {
    const context = await setup();
    const id = await created(
      await createProduct(db, {
        actorId: context.admin.id,
        input: context.form({ slug, status: "ACTIVE" }),
        now: NOW,
      }),
    );
    const rename = (next: string) =>
      updateProduct(db, {
        actorId: context.admin.id,
        productId: id,
        input: context.form({ slug: next, status: "ACTIVE" }),
        expectedStockOnHand: 10,
      });
    return { ...context, id, rename };
  }

  const redirects = async () =>
    (await db.redirect.findMany({ orderBy: { sourcePath: "asc" } })).map(
      ({ sourcePath, destinationPath, permanent }) => ({
        sourcePath,
        destinationPath,
        permanent,
      }),
    );

  it("keeps a published product's old URL working", async () => {
    const { id, rename } = await published("gammal-slug");

    expect(await rename("ny-slug")).toMatchObject({
      ok: true,
      redirectCreated: true,
      slugs: ["gammal-slug", "ny-slug"],
    });

    expect(await redirects()).toEqual([
      {
        sourcePath: "/pokemon-tcg/gammal-slug",
        destinationPath: "/pokemon-tcg/ny-slug",
        permanent: true,
      },
    ]);
    expect(await getProductBySlug(db, "gammal-slug", NOW)).toBeNull();
    expect(await findRedirectDestination(db, "/pokemon-tcg/gammal-slug")).toBe(
      "/pokemon-tcg/ny-slug",
    );
    expect(
      (await auditActions(id)).find((e) => e.action === "CHANGE_PRODUCT_SLUG")
        ?.metadata,
    ).toMatchObject({
      slug: { from: "gammal-slug", to: "ny-slug" },
      redirect: {
        from: "/pokemon-tcg/gammal-slug",
        to: "/pokemon-tcg/ny-slug",
      },
    });
  });

  it("flattens chains and never creates loops", async () => {
    const { rename } = await published("a");

    await rename("b");
    await rename("c");
    expect(await redirects()).toEqual([
      {
        sourcePath: "/pokemon-tcg/a",
        destinationPath: "/pokemon-tcg/c",
        permanent: true,
      },
      {
        sourcePath: "/pokemon-tcg/b",
        destinationPath: "/pokemon-tcg/c",
        permanent: true,
      },
    ]);

    // Back to an earlier slug: that URL is live again, so it stops redirecting.
    await rename("a");
    expect(await redirects()).toEqual([
      {
        sourcePath: "/pokemon-tcg/b",
        destinationPath: "/pokemon-tcg/a",
        permanent: true,
      },
      {
        sourcePath: "/pokemon-tcg/c",
        destinationPath: "/pokemon-tcg/a",
        permanent: true,
      },
    ]);
    for (const { sourcePath, destinationPath } of await redirects()) {
      expect(await findRedirectDestination(db, destinationPath)).toBeNull();
      expect(sourcePath).not.toBe(destinationPath);
    }
  });

  it("creates no redirect for a product that was never public", async () => {
    const { admin, form } = await setup();
    const id = await created(
      await createProduct(db, {
        actorId: admin.id,
        input: form({ slug: "utkast" }),
      }),
    );

    expect(
      await updateProduct(db, {
        actorId: admin.id,
        productId: id,
        input: form({ slug: "utkast-2" }),
        expectedStockOnHand: 10,
      }),
    ).toMatchObject({ ok: true, redirectCreated: false });
    expect(await db.redirect.count()).toBe(0);
  });
});

describe("deleteProduct", () => {
  it("deletes a never-published product without history, including its stored images", async () => {
    const { admin, form } = await setup();
    const storage = createMemoryStorage();
    const id = await created(
      await createProduct(db, { actorId: admin.id, input: form() }),
    );
    const key = productImageKey(id, "png");
    await storage.put(key, new Uint8Array([1]), "image/png");
    await db.productImage.create({
      data: {
        productId: id,
        storageKey: key,
        url: "/x",
        position: 0,
        width: 400,
        height: 400,
      },
    });

    expect(
      await deleteProduct(db, storage, { actorId: admin.id, productId: id }),
    ).toMatchObject({ ok: true });
    expect(await db.product.count()).toBe(0);
    expect(storage.objects.size).toBe(0);
    expect((await auditActions(id)).at(-1)).toMatchObject({
      action: "DELETE_PRODUCT",
      metadata: { sku: "SV10-BB-EN" },
    });
  });

  it("refuses products that were published; they must be archived", async () => {
    const { admin, category } = await setup();
    const product = await createProductRow(db, {
      categoryId: category.id,
      status: "ARCHIVED",
      publishedAt: NOW,
    });
    expect(
      await deleteProduct(db, createMemoryStorage(), {
        actorId: admin.id,
        productId: product.id,
      }),
    ).toEqual({ ok: false, error: "PUBLISHED" });
    expect(await db.product.count()).toBe(1);
  });

  it("never destroys order, reservation or review history", async () => {
    const { admin, category } = await setup();
    const sold = await createProductRow(db, {
      categoryId: category.id,
      status: "DRAFT",
    });
    const order = await createPaidOrderWithItem(db, sold, 2);
    const reserved = await createProductRow(db, {
      categoryId: category.id,
      status: "DRAFT",
    });
    await db.inventoryReservation.create({
      data: {
        orderId: (await createPendingOrder(db)).id,
        productId: reserved.id,
        quantity: 1,
        expiresAt: NOW,
      },
    });
    const reviewed = await createProductRow(db, {
      categoryId: category.id,
      status: "DRAFT",
    });
    await db.review.create({
      data: {
        productId: reviewed.id,
        displayName: "Kim",
        rating: 5,
        body: "Bra",
      },
    });

    for (const product of [sold, reserved, reviewed]) {
      expect(
        await deleteProduct(db, createMemoryStorage(), {
          actorId: admin.id,
          productId: product.id,
        }),
      ).toEqual({ ok: false, error: "HAS_HISTORY" });
    }
    expect(await db.product.count()).toBe(3);
    expect(
      await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } }),
    ).toMatchObject({ productId: sold.id, quantity: 2 });
  });
});

describe("listAdminProducts", () => {
  it("searches, filters by status and stock, and hides archived products by default", async () => {
    const { category } = await setup();
    await createProductRow(db, {
      categoryId: category.id,
      name: "Alfa box",
      sku: "ALFA-1",
      stockOnHand: 0,
    });
    await createProductRow(db, {
      categoryId: category.id,
      name: "Beta box",
      sku: "BETA-1",
      stockOnHand: 2,
    });
    await createProductRow(db, {
      categoryId: category.id,
      name: "Gamma",
      sku: "GAMMA-1",
      stockOnHand: 50,
    });
    await createProductRow(db, {
      categoryId: category.id,
      name: "Arkiv box",
      sku: "ARK-1",
      status: "ARCHIVED",
    });

    const names = async (query: Record<string, string>) =>
      (
        await listAdminProducts(db, {
          params: parseAdminProductParams(query),
          lowStockThreshold: 3,
          now: NOW,
        })
      ).rows.map((row) => row.name);

    expect(await names({})).toEqual(["Alfa box", "Beta box", "Gamma"]);
    expect(await names({ status: "alla" })).toHaveLength(4);
    expect(await names({ status: "ARCHIVED" })).toEqual(["Arkiv box"]);
    expect(await names({ q: "box" })).toEqual(["Alfa box", "Beta box"]);
    expect(await names({ q: "beta-1" })).toEqual(["Beta box"]);
    expect(await names({ q: "100%_" })).toEqual([]);
    expect(await names({ lager: "lagt" })).toEqual(["Alfa box", "Beta box"]);
    expect(await names({ lager: "slut" })).toEqual(["Alfa box"]);
    expect(await names({ sortering: "lager" })).toEqual([
      "Alfa box",
      "Beta box",
      "Gamma",
    ]);
  });
});
