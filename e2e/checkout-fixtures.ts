import { randomUUID } from "node:crypto";

import type { PrismaClient } from "../src/generated/prisma/client";
import { createPrismaClient } from "../src/lib/db/create-client";

/*
 * Data for the checkout E2E tests. Products are created per test with the
 * SKU prefix "CHK-E2E-" (deliberately not "E2E-", which the catalog-admin
 * cleanup deletes) so the seeded catalog the storefront tests count on never
 * gains reservations. Everything is removed again, including the pending
 * test orders, which exist only in the local/CI database.
 */

export const CHECKOUT_SKU_PREFIX = "CHK-E2E-";

let client: PrismaClient | undefined;

export function checkoutDb(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for this test");
  client ??= createPrismaClient(url);
  return client;
}

export async function disconnectCheckoutDb() {
  await client?.$disconnect();
  client = undefined;
}

export type TestProduct = {
  id: string;
  slug: string;
  name: string;
  priceAmount: number;
};

export async function createTestProduct(
  options: {
    name?: string;
    priceAmount?: number;
    stockOnHand?: number;
    isPreorder?: boolean;
    releaseInDays?: number;
  } = {},
): Promise<TestProduct> {
  const db = checkoutDb();
  const suffix = randomUUID().slice(0, 8);
  const category = await db.category.findUniqueOrThrow({
    where: { slug: "booster-boxes" },
  });
  const releaseDate =
    options.releaseInDays === undefined
      ? null
      : new Date(
          `${new Date(Date.now() + options.releaseInDays * 86_400_000).toISOString().slice(0, 10)}T00:00:00Z`,
        );
  return db.product.create({
    data: {
      sku: `${CHECKOUT_SKU_PREFIX}${suffix}`.toUpperCase(),
      slug: `chk-e2e-${suffix}`,
      name: options.name ?? `Kassatest ${suffix}`,
      priceAmount: options.priceAmount ?? 49_900,
      stockOnHand: options.stockOnHand ?? 20,
      status: options.isPreorder ? "COMING_SOON" : "ACTIVE",
      isPreorder: options.isPreorder ?? false,
      releaseDate,
      categoryId: category.id,
      publishedAt: new Date(Date.now() - 86_400_000),
    },
    select: { id: true, slug: true, name: true, priceAmount: true },
  });
}

/** Holds `quantity` units for another (simulated) customer. */
export async function reserveForSomeoneElse(
  productId: string,
  quantity: number,
) {
  const db = checkoutDb();
  await db.order.create({
    data: {
      subtotalAmount: 0,
      shippingAmount: 0,
      taxAmount: 0,
      totalAmount: 0,
      reservations: {
        create: {
          productId,
          quantity,
          expiresAt: new Date(Date.now() + 30 * 60_000),
        },
      },
    },
  });
}

export async function pendingOrdersFor(productId: string) {
  return checkoutDb().order.findMany({
    where: {
      items: { some: { productId } },
    },
    include: { items: true, reservations: true },
    orderBy: { createdAt: "asc" },
  });
}

/** Removes every checkout test product with its test orders. */
export async function removeCheckoutTestData(): Promise<void> {
  const db = checkoutDb();
  const products = await db.product.findMany({
    where: { sku: { startsWith: CHECKOUT_SKU_PREFIX } },
    select: { id: true },
  });
  const productIds = products.map((product) => product.id);
  if (productIds.length === 0) return;

  const orders = await db.order.findMany({
    where: {
      OR: [
        { items: { some: { productId: { in: productIds } } } },
        { reservations: { some: { productId: { in: productIds } } } },
      ],
    },
    select: { id: true },
  });
  const orderIds = orders.map((order) => order.id);
  await db.$transaction([
    db.inventoryReservation.deleteMany({
      where: { orderId: { in: orderIds } },
    }),
    db.orderItem.deleteMany({ where: { orderId: { in: orderIds } } }),
    db.order.deleteMany({ where: { id: { in: orderIds } } }),
    db.product.deleteMany({ where: { id: { in: productIds } } }),
  ]);
}
