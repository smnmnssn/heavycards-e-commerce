import { rm } from "node:fs/promises";
import { join } from "node:path";

import sharp from "sharp";

import { createPrismaClient } from "../src/lib/db/create-client";

import { E2E_STORAGE_DIR } from "./storage-dir";

/**
 * Catalog data created by the admin E2E tests is recognisable by prefix
 * (product SKUs "E2E-", slugs "e2e-") and removed before and after the run,
 * so the seeded catalog the storefront tests count on is left as it was.
 */
export const uniqueSuffix = () =>
  `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

export async function removeE2eCatalogData(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for this test");
  const db = createPrismaClient(url);
  try {
    const products = await db.product.findMany({
      where: { sku: { startsWith: "E2E-" } },
      select: { id: true },
    });
    // Test products never have orders, so deleting them (and their image
    // rows, by cascade) is safe here; the admin UI itself never allows it.
    await db.product.deleteMany({ where: { sku: { startsWith: "E2E-" } } });
    await db.category.deleteMany({ where: { slug: { startsWith: "e2e-" } } });
    await db.pokemonSet.deleteMany({ where: { slug: { startsWith: "e2e-" } } });
    await db.redirect.deleteMany({
      where: {
        OR: [
          { sourcePath: { contains: "/e2e-" } },
          { destinationPath: { contains: "/e2e-" } },
        ],
      },
    });
    await Promise.all(
      products.map(({ id }) =>
        rm(join(E2E_STORAGE_DIR, "products", id), {
          recursive: true,
          force: true,
        }),
      ),
    );
  } finally {
    await db.$disconnect();
  }
}

/** A real PNG of the given size, generated in memory. */
export async function pngImage(width = 900, height = 900, color = "#3a3a3a") {
  return sharp({
    create: { width, height, channels: 3, background: color },
  })
    .png()
    .toBuffer();
}
