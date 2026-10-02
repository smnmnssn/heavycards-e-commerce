import { randomBytes, randomUUID } from "node:crypto";

import type { Prisma } from "../src/generated/prisma/client";

import { checkoutDb } from "./checkout-fixtures";

/*
 * Data for the admin operations E2E tests (Milestone 12). Products use the
 * SKU prefix "OPS-E2E-" (not "E2E-", which the catalog-admin cleanup
 * deletes). Orders are written as payment finalization leaves them
 * (checkout and payment have their own E2E tests); everything the admin
 * screens do to them runs through the real server actions. All of it is
 * removed again, and the store settings are restored.
 */

export const OPS_SKU_PREFIX = "OPS-E2E-";

export type OpsProduct = {
  id: string;
  slug: string;
  name: string;
  sku: string;
  priceAmount: number;
};

export const suffix = () => randomUUID().slice(0, 8);

export async function createOpsProduct(
  name: string,
  { priceAmount = 39_900, stockOnHand = 10 } = {},
): Promise<OpsProduct> {
  const db = checkoutDb();
  const id = suffix();
  const category = await db.category.findUniqueOrThrow({
    where: { slug: "booster-boxes" },
  });
  return db.product.create({
    data: {
      sku: `${OPS_SKU_PREFIX}${id}`.toUpperCase(),
      slug: `ops-e2e-${id}`,
      name: `${name} ${id}`,
      priceAmount,
      stockOnHand,
      status: "ACTIVE",
      categoryId: category.id,
      publishedAt: new Date(Date.now() - 86_400_000),
    },
    select: { id: true, slug: true, name: true, sku: true, priceAmount: true },
  });
}

export type OpsOrder = Awaited<ReturnType<typeof createOpsOrder>>;

/** A paid order (by default) with one line, as finalization leaves it. */
export async function createOpsOrder(
  product: OpsProduct,
  overrides: Partial<Prisma.OrderUncheckedCreateInput> = {},
  quantity = 1,
) {
  const lineTotal = product.priceAmount * quantity;
  return checkoutDb().order.create({
    data: {
      paymentStatus: "PAID",
      paidAt: new Date(),
      email: `ops-${suffix()}@example.com`,
      customerName: `Olle Operativ ${suffix()}`,
      phone: "+46701234567",
      addressLine1: "Driftgatan 12",
      postalCode: "411 19",
      city: "Göteborg",
      confirmationEmailSentAt: new Date(),
      subtotalAmount: lineTotal,
      shippingAmount: 7_900,
      taxAmount: Math.round(((lineTotal + 7_900) * 2_500) / 12_500),
      totalAmount: lineTotal + 7_900,
      shippingCarrier: "POSTNORD",
      stripeCheckoutSessionId: `cs_test_ops_${suffix()}`,
      stripePaymentIntentId: `pi_test_ops_${suffix()}`,
      ...overrides,
      items: {
        create: {
          productId: product.id,
          productNameSnapshot: product.name,
          skuSnapshot: product.sku,
          quantity,
          unitPriceAmount: product.priceAmount,
          totalPriceAmount: lineTotal,
          vatRateBasisPoints: 2_500,
        },
      },
    },
    include: { items: true },
  });
}

/** A shipped order with a pending verified review of its line. */
export async function createPendingReview(product: OpsProduct, body: string) {
  const order = await createOpsOrder(product, {
    fulfillmentStatus: "SHIPPED",
    shippedAt: new Date(),
    shippingEmailSentAt: new Date(),
  });
  const review = await checkoutDb().review.create({
    data: {
      productId: product.id,
      orderItemId: order.items[0]!.id,
      displayName: "Olle O.",
      rating: 5,
      title: "Toppen",
      body,
      verifiedPurchase: true,
    },
  });
  return { order, review };
}

export async function recordAttention(
  orderId: string,
  action: "PAYMENT_NEEDS_ATTENTION" | "EMAIL_NEEDS_ATTENTION",
  metadata: Prisma.InputJsonObject,
) {
  return checkoutDb().auditLog.create({
    data: { action, entityType: "Order", entityId: orderId, metadata },
  });
}

export async function orderState(orderId: string) {
  return checkoutDb().order.findUniqueOrThrow({
    where: { id: orderId },
    include: { emailDeliveries: true, reviewToken: true },
  });
}

// --- Store settings ----------------------------------------------------------------

type Settings = Prisma.StoreSettingsGetPayload<object>;
let savedSettings: Settings | null = null;

export async function snapshotStoreSettings() {
  savedSettings = await checkoutDb().storeSettings.findUnique({
    where: { id: 1 },
  });
}

/** Safety net if a test failed before restoring through the UI. */
export async function restoreStoreSettings() {
  if (!savedSettings) return;
  const {
    storeName,
    contactEmail,
    companyName,
    organizationNumber,
    shippingPriceAmount,
    freeShippingThresholdAmount,
    defaultShippingCarrier,
    vatRateBasisPoints,
    lowStockThreshold,
    defaultSeoTitle,
    defaultSeoDescription,
  } = savedSettings;
  await checkoutDb().storeSettings.update({
    where: { id: 1 },
    data: {
      storeName,
      contactEmail,
      companyName,
      organizationNumber,
      shippingPriceAmount,
      freeShippingThresholdAmount,
      defaultShippingCarrier,
      vatRateBasisPoints,
      lowStockThreshold,
      defaultSeoTitle,
      defaultSeoDescription,
    },
  });
}

export const uniqueContactEmail = () =>
  `ops-${randomBytes(4).toString("hex")}@heavycards.test`;

// --- Cleanup -----------------------------------------------------------------------

/**
 * Removes every OPS product with its orders, reviews and audit entries, and
 * the settings audit entries written since `settingsChangedSince`.
 */
export async function removeOpsTestData(
  settingsChangedSince?: Date,
): Promise<void> {
  const db = checkoutDb();
  const products = await db.product.findMany({
    where: { sku: { startsWith: OPS_SKU_PREFIX } },
    select: { id: true },
  });
  const productIds = products.map((product) => product.id);
  const orders = await db.order.findMany({
    where: { items: { some: { productId: { in: productIds } } } },
    select: { id: true },
  });
  const orderIds = orders.map((order) => order.id);
  const reviews = await db.review.findMany({
    where: { productId: { in: productIds } },
    select: { id: true },
  });
  await db.$transaction([
    db.auditLog.deleteMany({
      where: {
        OR: [
          { entityType: "Order", entityId: { in: orderIds } },
          { entityType: "Review", entityId: { in: reviews.map((r) => r.id) } },
          ...(settingsChangedSince
            ? [
                {
                  entityType: "StoreSettings",
                  createdAt: { gte: settingsChangedSince },
                },
              ]
            : []),
        ],
      },
    }),
    db.review.deleteMany({ where: { productId: { in: productIds } } }),
    db.reviewToken.deleteMany({ where: { orderId: { in: orderIds } } }),
    db.emailDelivery.deleteMany({ where: { orderId: { in: orderIds } } }),
    db.inventoryReservation.deleteMany({
      where: { orderId: { in: orderIds } },
    }),
    db.orderItem.deleteMany({ where: { orderId: { in: orderIds } } }),
    db.order.deleteMany({ where: { id: { in: orderIds } } }),
    db.product.deleteMany({ where: { id: { in: productIds } } }),
  ]);
}
