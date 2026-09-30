import { createPrismaClient } from "../src/lib/db/create-client";

/**
 * Read-only lookup of seeded product IDs by SKU, for tests that must plant a
 * stale cart in browser storage. Never writes to the database.
 */
export async function productIds(
  skus: readonly string[],
): Promise<Record<string, string>> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for this test");
  const db = createPrismaClient(url);
  try {
    const products = await db.product.findMany({
      where: { sku: { in: [...skus] } },
      select: { id: true, sku: true },
    });
    return Object.fromEntries(products.map(({ sku, id }) => [sku, id]));
  } finally {
    await db.$disconnect();
  }
}
