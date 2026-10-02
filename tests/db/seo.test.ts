import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { productPath } from "@/lib/catalog-paths";
import type { ProductFormValues } from "@/lib/validation/catalog";
import { createProduct, updateProduct } from "@/server/admin/catalog/products";
import { findRedirectDestination } from "@/server/catalog/redirects";
import { buildSitemap } from "@/server/catalog/sitemap";
import {
  getCategoryBySlug,
  getSetBySlug,
  getSitemapData,
  listProducts,
} from "@/server/data/catalog-queries";
import { isListable } from "@/server/domain/catalog";

import { seedDatabase } from "../../prisma/seed/seed-database";
import { createAdmin } from "./auth-helpers";
import { createTestDb, resetDatabase } from "./test-database";

/*
 * SEO data against the seeded catalog: what the sitemap lists, which landing
 * pages are indexable, and how slug changes keep sitemap and redirects in
 * agreement.
 */

const db = createTestDb();
const now = new Date();
const siteUrl = "https://heavycards.se";

beforeAll(async () => {
  await resetDatabase(db);
  await seedDatabase(db, now);
});
afterAll(() => db.$disconnect());

const sitemapUrls = async () =>
  buildSitemap(siteUrl, await getSitemapData(db, new Date())).map(
    (entry) => entry.url,
  );

describe("sitemap data", () => {
  it("lists exactly the listable products: no drafts, archived or future publications", async () => {
    const data = await getSitemapData(db, now);
    const all = await db.product.findMany({
      select: { slug: true, status: true, publishedAt: true },
    });

    expect(data.products.map((p) => p.slug).sort()).toEqual(
      all
        .filter((product) => isListable(product, now))
        .map((p) => p.slug)
        .sort(),
    );
    const slugs = data.products.map((p) => p.slug);
    expect(slugs).not.toContain("mega-evolution-booster-box"); // DRAFT
    expect(slugs).not.toContain("scarlet-violet-151-booster-bundle"); // ARCHIVED
    expect(slugs).toContain("kommande-set-booster-box"); // COMING_SOON
    expect(slugs).toContain("prismatic-evolutions-elite-trainer-box"); // sold out
  });

  it("agrees with the storefront listing", async () => {
    const data = await getSitemapData(db, now);
    const listing = await listProducts(db, {
      sort: "newest",
      page: 1,
      pageSize: 100,
      now,
    });

    expect(data.products.map((p) => p.slug).sort()).toEqual(
      listing.items.map((p) => p.slug).sort(),
    );
  });

  it("includes each product's primary image", async () => {
    const data = await getSitemapData(db, now);
    const boosterBox = await db.product.findUniqueOrThrow({
      where: { slug: "destined-rivals-booster-box" },
      select: {
        images: {
          orderBy: { position: "asc" },
          take: 1,
          select: { url: true },
        },
      },
    });

    expect(
      data.products.find((p) => p.slug === "destined-rivals-booster-box")
        ?.imageUrl,
    ).toBe(boosterBox.images[0]?.url ?? null);
  });

  it("lists only categories and sets with listable products", async () => {
    const data = await getSitemapData(db, now);

    expect(data.categories.map((c) => c.slug).sort()).toEqual([
      "booster-boxes",
      "booster-packs",
      "collection-boxes",
      "elite-trainer-boxes",
      "tillbehor",
      "tins",
    ]);
    const sets = data.sets.map((s) => s.slug);
    expect(sets).toContain("destined-rivals");
    expect(sets).toContain("kommande-set"); // coming-soon products are listed
    expect(sets).not.toContain("scarlet-violet-151"); // archived products only
    expect(sets).not.toContain("mega-evolution"); // draft products only
  });

  it("dates landing pages by their own or their products' latest change", async () => {
    const data = await getSitemapData(db, now);
    const category = await db.category.findUniqueOrThrow({
      where: { slug: "booster-boxes" },
      select: {
        updatedAt: true,
        products: {
          where: { status: { in: ["ACTIVE", "COMING_SOON"] } },
          select: { updatedAt: true },
        },
      },
    });
    const expected = Math.max(
      category.updatedAt.getTime(),
      ...category.products.map((p) => p.updatedAt.getTime()),
    );

    expect(
      data.categories
        .find((c) => c.slug === "booster-boxes")
        ?.lastModified.getTime(),
    ).toBe(expected);
    expect(data.catalogUpdatedAt).toBeInstanceOf(Date);
  });

  it("is bounded", async () => {
    const data = await getSitemapData(db, now, 3);

    expect(data.products).toHaveLength(3);
  });
});

describe("landing page indexability", () => {
  it("counts only listable products on category and set pages", async () => {
    expect(
      (await getCategoryBySlug(db, "booster-boxes", now))?.listableProductCount,
    ).toBe(3);
    expect(
      (await getSetBySlug(db, "scarlet-violet-151", now))?.listableProductCount,
    ).toBe(0);
    expect(
      (await getSetBySlug(db, "mega-evolution", now))?.listableProductCount,
    ).toBe(0);
    expect(await getSetBySlug(db, "finns-inte", now)).toBeNull();
  });
});

describe("sitemap and redirects after catalog changes", () => {
  async function publishedProduct(slug: string) {
    const admin = await createAdmin(db, { role: "ADMIN" });
    const category = await db.category.findUniqueOrThrow({
      where: { slug: "tins" },
    });
    const form = (overrides: Partial<ProductFormValues> = {}) =>
      ({
        name: "SEO Tin",
        slug,
        shortDescription: "",
        description: "",
        productType: "SEALED",
        categoryId: category.id,
        pokemonSetId: "",
        price: "199",
        compareAtPrice: "",
        sku: `seo-${slug}`,
        stockOnHand: "5",
        status: "ACTIVE",
        isPreorder: false,
        isFeatured: false,
        releaseDate: "",
        seoTitle: "",
        seoDescription: "",
        ...overrides,
      }) satisfies ProductFormValues;
    const result = await createProduct(db, {
      actorId: admin.id,
      input: form(),
      now: new Date(Date.now() - 1000),
    });
    if (!result.ok) throw new Error(JSON.stringify(result));
    const update = (overrides: Partial<ProductFormValues>) =>
      updateProduct(db, {
        actorId: admin.id,
        productId: result.productId,
        input: form(overrides),
        expectedStockOnHand: 5,
      });
    return { update };
  }

  it("a renamed product leaves the sitemap at its old URL, which redirects to the listed new one", async () => {
    const { update } = await publishedProduct("seo-tin-gammal");
    expect(await sitemapUrls()).toContain(
      `${siteUrl}${productPath("seo-tin-gammal")}`,
    );

    expect(await update({ slug: "seo-tin-ny" })).toMatchObject({ ok: true });

    const urls = await sitemapUrls();
    expect(urls).toContain(`${siteUrl}${productPath("seo-tin-ny")}`);
    expect(urls).not.toContain(`${siteUrl}${productPath("seo-tin-gammal")}`);
    const destination = await findRedirectDestination(
      db,
      productPath("seo-tin-gammal"),
    );
    expect(destination).toBe(productPath("seo-tin-ny"));
    // The redirect target is itself a listed, live URL (no chain).
    expect(urls).toContain(`${siteUrl}${destination}`);
    expect(await findRedirectDestination(db, destination!)).toBeNull();
  });

  it("archiving removes a product from the sitemap", async () => {
    const { update } = await publishedProduct("seo-tin-arkiv");

    await update({ status: "ARCHIVED" });
    expect(await sitemapUrls()).not.toContain(
      `${siteUrl}${productPath("seo-tin-arkiv")}`,
    );
  });
});
