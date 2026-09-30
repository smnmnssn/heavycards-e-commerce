import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  getProductBySlug,
  listCategories,
  listProducts,
  listSets,
  type ListingQuery,
} from "@/server/data/catalog-queries";
import { getAvailability, isListable } from "@/server/domain/catalog";
import { availableToSell } from "@/server/domain/inventory";

import { seedDatabase } from "../../prisma/seed/seed-database";
import { createCategory, createPendingOrder, createProduct } from "./factories";
import { createTestDb, resetDatabase } from "./test-database";

const db = createTestDb();
const now = new Date();

const query = (overrides: Partial<ListingQuery> = {}): ListingQuery => ({
  sort: "newest",
  page: 1,
  pageSize: 50,
  now,
  ...overrides,
});

const skus = async (overrides: Partial<ListingQuery> = {}) => {
  const { items } = await listProducts(db, query(overrides));
  const bySlug = await db.product.findMany({
    where: { id: { in: items.map((item) => item.id) } },
    select: { id: true, sku: true },
  });
  const sku = new Map(bySlug.map((p) => [p.id, p.sku]));
  return items.map((item) => sku.get(item.id)!);
};

beforeAll(async () => {
  await resetDatabase(db);
  await seedDatabase(db, now);
});
afterAll(() => db.$disconnect());

describe("listProducts visibility", () => {
  it("lists only published ACTIVE and COMING_SOON products", async () => {
    const listed = await skus();

    expect(listed).not.toContain("ME01-BB-EN"); // DRAFT
    expect(listed).not.toContain("SV3PT5-BNDL-EN"); // ARCHIVED
    expect(listed).toContain("UPCOMING-BB-EN"); // COMING_SOON
    expect(listed).toContain("SV8PT5-ETB-EN"); // ACTIVE, sold out
    expect(listed).toHaveLength(10);
  });

  it("agrees with the domain isListable() rule for every product", async () => {
    const all = await db.product.findMany({
      select: { id: true, status: true, publishedAt: true },
    });
    const { items } = await listProducts(db, query());
    const listed = new Set(items.map((item) => item.id));

    for (const product of all) {
      expect(listed.has(product.id)).toBe(isListable(product, now));
    }
  });

  it("computes availability exactly like the domain rule", async () => {
    const { items } = await listProducts(db, query());
    const products = await db.product.findMany({
      include: { reservations: true },
    });
    for (const item of items) {
      const product = products.find((p) => p.id === item.id)!;
      expect(item.availableQuantity).toBe(
        availableToSell(product.stockOnHand, product.reservations, now),
      );
    }
  });
});

describe("listProducts filters", () => {
  it("filters by category and set slug", async () => {
    expect(await skus({ categorySlug: "booster-boxes" })).toEqual(
      expect.arrayContaining(["SV10-BB-EN", "SV09-BB-EN", "UPCOMING-BB-EN"]),
    );
    expect(await skus({ categorySlug: "booster-boxes" })).toHaveLength(3);
    expect((await skus({ setSlug: "destined-rivals" })).sort()).toEqual(
      ["SV10-BB-EN", "SV10-BP-EN", "SV10-ETB-EN"].sort(),
    );
  });

  it("in-stock filter keeps only products purchasable right now", async () => {
    const inStock = await skus({ inStockOnly: true });

    expect(inStock).not.toContain("SV8PT5-ETB-EN"); // sold out
    expect(inStock).not.toContain("UPCOMING-BB-EN"); // coming soon, no preorder
    expect(inStock).toContain("UPCOMING-ETB-EN"); // preorder with allocation
    expect(inStock).toContain("SV10-ETB-EN"); // low stock is still in stock
  });

  it("in-stock filter respects active reservations", async () => {
    const product = await createProduct(db, {
      stockOnHand: 1,
      publishedAt: now,
      categoryId: (await createCategory(db)).id,
    });
    const order = await createPendingOrder(db);
    await db.inventoryReservation.create({
      data: {
        orderId: order.id,
        productId: product.id,
        quantity: 1,
        expiresAt: new Date(now.getTime() + 60_000),
      },
    });

    expect(await skus({ inStockOnly: true })).not.toContain(product.sku);

    // An expired reservation no longer holds the last unit.
    await db.inventoryReservation.updateMany({
      where: { productId: product.id },
      data: { expiresAt: new Date(now.getTime() - 1_000) },
    });
    expect(await skus({ inStockOnly: true })).toContain(product.sku);
    await db.inventoryReservation.deleteMany({
      where: { productId: product.id },
    });
    await db.order.delete({ where: { id: order.id } });
    await db.product.delete({ where: { id: product.id } });
  });

  it("excludes a given product (related products)", async () => {
    const { items } = await listProducts(db, query());
    const excluded = items[0]!.id;

    const { items: rest } = await listProducts(
      db,
      query({ excludeProductId: excluded }),
    );

    expect(rest.map((item) => item.id)).not.toContain(excluded);
  });
});

describe("listProducts scopes", () => {
  it("new arrivals are recently published ACTIVE products", async () => {
    const listed = await skus({ scope: "new" });

    expect(listed).toContain("SV10-BB-EN"); // 3 days
    expect(listed).toContain("SV8PT5-SPC-EN"); // 40 days
    expect(listed).not.toContain("ACC-TL35-25"); // 90 days
    expect(listed).not.toContain("UPCOMING-ETB-EN"); // COMING_SOON
  });

  it("upcoming lists coming-soon and preorder products by release date", async () => {
    const listed = await skus({ scope: "upcoming", sort: "release" });

    expect(listed.sort()).toEqual(["UPCOMING-BB-EN", "UPCOMING-ETB-EN"]);
  });

  it("featured lists admin-featured products only", async () => {
    expect((await skus({ scope: "featured" })).sort()).toEqual(
      ["SV10-BB-EN", "SV09-BB-EN", "SV8PT5-SPC-EN"].sort(),
    );
  });
});

describe("listProducts sorting and paging", () => {
  it("sorts by price in both directions", async () => {
    const asc = (await listProducts(db, query({ sort: "price-asc" }))).items;
    const desc = (await listProducts(db, query({ sort: "price-desc" }))).items;
    const prices = asc.map((item) => item.priceAmount);

    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(desc.map((item) => item.priceAmount)).toEqual([...prices].reverse());
  });

  it("sorts newest first by default", async () => {
    const { items } = await listProducts(db, query());
    const times = items.map((item) => item.publishedAt.getTime());

    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("pages without overlap and reports the total", async () => {
    const page1 = await listProducts(db, query({ pageSize: 4, page: 1 }));
    const page3 = await listProducts(db, query({ pageSize: 4, page: 3 }));
    const beyond = await listProducts(db, query({ pageSize: 4, page: 9 }));

    expect(page1.total).toBe(10);
    expect(page1.items).toHaveLength(4);
    expect(page3.items).toHaveLength(2);
    expect(page1.items.map((i) => i.id)).not.toContain(page3.items[0]!.id);
    expect(beyond).toEqual({ items: [], total: 10 });
  });
});

describe("search", () => {
  it("matches every term across name, set and category", async () => {
    expect((await skus({ searchTerms: ["destined", "box"] })).sort()).toEqual(
      ["SV10-BB-EN", "SV10-ETB-EN"].sort(),
    );
    expect(await skus({ searchTerms: ["tins"] })).toEqual(["SV08-MT-EN"]);
  });

  it("folds accented e, so 'pokemon' finds 'Pokémon'", async () => {
    const product = await createProduct(db, {
      name: "Pokémon Center Elite Trainer Box",
      publishedAt: now,
    });

    expect(await skus({ searchTerms: ["pokemon", "center"] })).toEqual([
      product.sku,
    ]);
    await db.product.delete({ where: { id: product.id } });
  });

  it("treats LIKE wildcards in input literally", async () => {
    expect(await skus({ searchTerms: ["%"] })).toEqual([]);
    expect(await skus({ searchTerms: ["__"] })).toEqual([]);
  });

  it("never returns drafts or archived products", async () => {
    expect(await skus({ searchTerms: ["mega"] })).toEqual([]);
    expect(await skus({ searchTerms: ["151"] })).toEqual([]);
  });

  it("ranks name matches first for relevance sorting", async () => {
    const { items } = await listProducts(
      db,
      query({ searchTerms: ["elite"], sort: "relevance" }),
    );

    expect(items[0]?.name).toContain("Elite");
  });
});

describe("taxonomy", () => {
  it("counts only listable products per category and set", async () => {
    const categories = await listCategories(db, now);
    const sets = await listSets(db, now);

    expect(categories.map((c) => c.slug)[0]).toBe("booster-boxes");
    expect(
      categories.find((c) => c.slug === "booster-boxes")?.productCount,
    ).toBe(3);
    // The archived 151 bundle is not counted.
    expect(
      sets.find((s) => s.slug === "scarlet-violet-151")?.productCount,
    ).toBe(0);
    expect(sets.find((s) => s.slug === "mega-evolution")?.productCount).toBe(0);
    expect(sets[0]?.slug).toBe("kommande-set"); // newest release first
  });
});

describe("getProductBySlug", () => {
  it("returns null for unknown slugs and drafts", async () => {
    expect(await getProductBySlug(db, "finns-inte", now)).toBeNull();
    expect(
      await getProductBySlug(db, "mega-evolution-booster-box", now),
    ).toBeNull();
  });

  it("returns archived products so the page can show a discontinued notice", async () => {
    const product = await getProductBySlug(
      db,
      "scarlet-violet-151-booster-bundle",
      now,
    );

    expect(product?.status).toBe("ARCHIVED");
  });

  it("includes only APPROVED reviews in the list and the summary", async () => {
    const etb = await getProductBySlug(
      db,
      "destined-rivals-elite-trainer-box",
      now,
    );
    const pack = await getProductBySlug(
      db,
      "destined-rivals-booster-pack",
      now,
    );
    const toploaders = await getProductBySlug(db, "toploaders-35pt-25-st", now);

    expect(etb?.reviews).toHaveLength(1);
    expect(etb?.reviewSummary).toEqual({ count: 1, averageRating: 5 });
    // Pending and rejected reviews exist but are never exposed.
    expect(pack?.reviews).toEqual([]);
    expect(pack?.reviewSummary).toEqual({ count: 0, averageRating: null });
    expect(toploaders?.reviews).toEqual([]);
  });

  it("derives availability from stock minus active reservations", async () => {
    const boosterBox = await getProductBySlug(
      db,
      "destined-rivals-booster-box",
      now,
    );

    // Seed: 12 in stock, 1 reserved by a pending checkout.
    expect(boosterBox?.availableQuantity).toBe(11);
    expect(
      getAvailability({
        status: boosterBox!.status,
        isPreorder: boosterBox!.isPreorder,
        availableQuantity: boosterBox!.availableQuantity,
        lowStockThreshold: 3,
      }),
    ).toBe("in_stock");
  });
});

describe("unpublished products", () => {
  beforeEach(async () => {
    await db.product.deleteMany({ where: { sku: { startsWith: "FUTURE-" } } });
  });

  it("hides products scheduled to publish in the future", async () => {
    const product = await createProduct(db, {
      sku: "FUTURE-1",
      publishedAt: new Date(now.getTime() + 86_400_000),
    });

    expect(await skus()).not.toContain("FUTURE-1");
    expect(await getProductBySlug(db, product.slug, now)).toBeNull();
    await db.product.delete({ where: { id: product.id } });
  });
});
