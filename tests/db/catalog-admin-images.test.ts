import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createMemoryStorage } from "@/lib/storage/memory";
import { PRODUCT_IMAGES_PER_PRODUCT_MAX } from "@/lib/validation/product-images";
import {
  removeProductImage,
  reorderProductImages,
  updateProductImageAlt,
  uploadProductImage,
} from "@/server/admin/catalog/product-images";
import { getProductBySlug, listProducts } from "@/server/data/catalog-queries";

import { createAdmin } from "./auth-helpers";
import { createProduct } from "./factories";
import { createTestDb, resetDatabase } from "./test-database";

const db = createTestDb();

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

const pngFile = async (width = 800, height = 600, name = "bild.png") => ({
  bytes: new Uint8Array(
    await sharp({
      create: { width, height, channels: 3, background: "#777777" },
    })
      .png()
      .toBuffer(),
  ),
  type: "image/png",
  name,
});

async function setup() {
  const admin = await createAdmin(db);
  const product = await createProduct(db, {
    publishedAt: new Date("2026-01-01T00:00:00Z"),
  });
  const storage = createMemoryStorage();
  const upload = async (file?: Awaited<ReturnType<typeof pngFile>>) => {
    const result = await uploadProductImage(db, storage, {
      actorId: admin.id,
      productId: product.id,
      file: file ?? (await pngFile()),
    });
    if (!result.ok) throw new Error(result.message);
    return result.image;
  };
  const images = () =>
    db.productImage.findMany({
      where: { productId: product.id },
      orderBy: { position: "asc" },
    });
  return { admin, product, storage, upload, images };
}

describe("uploadProductImage", () => {
  it("stores the normalized file and appends it with its pixel size", async () => {
    const { admin, product, storage, upload, images } = await setup();

    const first = await upload();
    const second = await upload(await pngFile(600, 900));

    const rows = await images();
    expect(
      rows.map((row) => [row.id, row.position, row.width, row.height]),
    ).toEqual([
      [first.id, 0, 800, 600],
      [second.id, 1, 600, 900],
    ]);
    expect([...storage.objects.keys()]).toEqual(
      rows.map((row) => row.storageKey),
    );
    expect(rows[0]!.storageKey).toMatch(
      new RegExp(`^products/${product.id}/[0-9a-f-]{36}\\.png$`),
    );
    expect(rows[0]!.url).toBe(`https://storage.test/${rows[0]!.storageKey}`);
    expect(
      await db.auditLog.count({
        where: { action: "ADD_PRODUCT_IMAGE", adminUserId: admin.id },
      }),
    ).toBe(2);
  });

  it("rejects invalid files without storing anything", async () => {
    const { admin, product, storage } = await setup();

    const result = await uploadProductImage(db, storage, {
      actorId: admin.id,
      productId: product.id,
      file: {
        bytes: new TextEncoder().encode("<svg/>"),
        type: "image/png",
        name: "x.png",
      },
    });

    expect(result).toEqual({
      ok: false,
      error: "INVALID_FILE",
      message: expect.stringContaining("JPEG"),
    });
    expect(storage.objects.size).toBe(0);
    expect(await db.productImage.count()).toBe(0);
  });

  it("stores nothing for an unknown product", async () => {
    const { admin, storage } = await setup();
    expect(
      await uploadProductImage(db, storage, {
        actorId: admin.id,
        productId: "01999999-0000-7000-8000-0000000000aa",
        file: await pngFile(),
      }),
    ).toMatchObject({ ok: false, error: "NOT_FOUND" });
    expect(storage.objects.size).toBe(0);
  });

  it("reports a storage failure and writes no row", async () => {
    const { admin, product, storage } = await setup();
    storage.failNextPut = true;
    const log = console.error;
    console.error = () => {};
    try {
      expect(
        await uploadProductImage(db, storage, {
          actorId: admin.id,
          productId: product.id,
          file: await pngFile(),
        }),
      ).toMatchObject({ ok: false, error: "STORAGE" });
    } finally {
      console.error = log;
    }
    expect(await db.productImage.count()).toBe(0);
  });

  it(`allows at most ${PRODUCT_IMAGES_PER_PRODUCT_MAX} images per product`, async () => {
    const { admin, product, storage } = await setup();
    await db.productImage.createMany({
      data: Array.from({ length: PRODUCT_IMAGES_PER_PRODUCT_MAX }, (_, i) => ({
        productId: product.id,
        storageKey: `seed/test-${i}`,
        url: "/brand/product-example-img.webp",
        position: i,
        width: 400,
        height: 400,
      })),
    });

    expect(
      await uploadProductImage(db, storage, {
        actorId: admin.id,
        productId: product.id,
        file: await pngFile(),
      }),
    ).toMatchObject({ ok: false, error: "LIMIT" });
    expect(storage.objects.size).toBe(0);
  });
});

describe("ordering, alt text and removal", () => {
  it("reorders images; the first one becomes the storefront's primary image", async () => {
    const { admin, product, upload, images } = await setup();
    const a = await upload();
    const b = await upload();
    const c = await upload();

    expect(
      await reorderProductImages(db, {
        actorId: admin.id,
        productId: product.id,
        orderedIds: [c.id, a.id, b.id],
      }),
    ).toMatchObject({ ok: true });

    expect((await images()).map((row) => [row.id, row.position])).toEqual([
      [c.id, 0],
      [a.id, 1],
      [b.id, 2],
    ]);
    const now = new Date();
    expect(
      (await getProductBySlug(db, product.slug, now))!.images.map((i) => i.id),
    ).toEqual([c.id, a.id, b.id]);
    const listing = await listProducts(db, {
      sort: "newest",
      page: 1,
      pageSize: 5,
      now,
    });
    expect(listing.items[0]!.image?.url).toBe(c.url);
    expect(
      await db.auditLog.findFirst({
        where: { action: "REORDER_PRODUCT_IMAGES" },
      }),
    ).toMatchObject({
      metadata: { from: [a.id, b.id, c.id], to: [c.id, a.id, b.id] },
    });
  });

  it("rejects an order that does not list exactly the product's images", async () => {
    const { admin, product, upload, images } = await setup();
    const a = await upload();
    const b = await upload();
    const other = await createProduct(db);
    const foreign = await db.productImage.create({
      data: {
        productId: other.id,
        storageKey: "seed/foreign",
        url: "/x",
        position: 0,
        width: 400,
        height: 400,
      },
    });

    for (const orderedIds of [
      [a.id],
      [a.id, a.id],
      [a.id, foreign.id],
      [b.id, a.id, foreign.id],
    ]) {
      expect(
        await reorderProductImages(db, {
          actorId: admin.id,
          productId: product.id,
          orderedIds,
        }),
      ).toMatchObject({ ok: false, error: "INVALID_INPUT" });
    }
    expect((await images()).map((row) => row.id)).toEqual([a.id, b.id]);
  });

  it("saves and clears alt text", async () => {
    const { admin, product, upload } = await setup();
    const image = await upload();
    const save = (altText: string) =>
      updateProductImageAlt(db, {
        actorId: admin.id,
        productId: product.id,
        imageId: image.id,
        altText,
      });

    await save("  Displayen framifrån  ");
    expect(
      (await db.productImage.findUniqueOrThrow({ where: { id: image.id } }))
        .altText,
    ).toBe("Displayen framifrån");
    await save("   ");
    expect(
      (await db.productImage.findUniqueOrThrow({ where: { id: image.id } }))
        .altText,
    ).toBeNull();
    expect(await save("x".repeat(301))).toMatchObject({
      error: "INVALID_INPUT",
    });
  });

  it("removes an image, closes the gap and deletes the stored file", async () => {
    const { admin, product, storage, upload, images } = await setup();
    const a = await upload();
    const b = await upload();
    const c = await upload();
    const keyOfB = (await images())[1]!.storageKey;

    expect(
      await removeProductImage(db, storage, {
        actorId: admin.id,
        productId: product.id,
        imageId: b.id,
      }),
    ).toMatchObject({ ok: true });

    expect((await images()).map((row) => [row.id, row.position])).toEqual([
      [a.id, 0],
      [c.id, 1],
    ]);
    expect(storage.objects.has(keyOfB)).toBe(false);
    expect(storage.objects.size).toBe(2);
    expect(
      await db.auditLog.count({ where: { action: "REMOVE_PRODUCT_IMAGE" } }),
    ).toBe(1);
  });

  it("removes development seed images without touching storage", async () => {
    const { admin, product, storage } = await setup();
    const seeded = await db.productImage.create({
      data: {
        productId: product.id,
        storageKey: "seed/product-example-img/X",
        url: "/brand/product-example-img.webp",
        position: 0,
        width: 1920,
        height: 1920,
      },
    });
    expect(
      await removeProductImage(db, storage, {
        actorId: admin.id,
        productId: product.id,
        imageId: seeded.id,
      }),
    ).toMatchObject({ ok: true });
    expect(await db.productImage.count()).toBe(0);
  });

  it("refuses to touch another product's image", async () => {
    const { admin, product, storage } = await setup();
    const other = await createProduct(db);
    const foreign = await db.productImage.create({
      data: {
        productId: other.id,
        storageKey: "seed/foreign",
        url: "/x",
        position: 0,
        width: 400,
        height: 400,
      },
    });
    expect(
      await removeProductImage(db, storage, {
        actorId: admin.id,
        productId: product.id,
        imageId: foreign.id,
      }),
    ).toMatchObject({ ok: false, error: "NOT_FOUND" });
    expect(
      await updateProductImageAlt(db, {
        actorId: admin.id,
        productId: product.id,
        imageId: foreign.id,
        altText: "x",
      }),
    ).toMatchObject({ ok: false, error: "NOT_FOUND" });
    expect(await db.productImage.count()).toBe(1);
  });
});
