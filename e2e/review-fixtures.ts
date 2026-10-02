import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { expect } from "@playwright/test";

import { checkoutDb, outboxEmailFor } from "./checkout-fixtures";

/*
 * Data for the review E2E tests (Milestone 11). Products use the SKU prefix
 * "REV-E2E-" (not "E2E-", which the catalog-admin cleanup deletes); their
 * paid orders, invitations, reviews and audit entries are removed again.
 * Orders are written as paid directly (checkout and payment have their own
 * E2E tests); shipping, the shipping email and moderation run through the
 * real services via e2e/support/review-actions.ts.
 */

export const REVIEW_SKU_PREFIX = "REV-E2E-";

export type ReviewTestProduct = { id: string; slug: string; name: string };

export async function createReviewProduct(
  name: string,
): Promise<ReviewTestProduct> {
  const db = checkoutDb();
  const suffix = randomUUID().slice(0, 8);
  const category = await db.category.findUniqueOrThrow({
    where: { slug: "booster-boxes" },
  });
  return db.product.create({
    data: {
      sku: `${REVIEW_SKU_PREFIX}${suffix}`.toUpperCase(),
      slug: `rev-e2e-${suffix}`,
      name: `${name} ${suffix}`,
      priceAmount: 39_900,
      stockOnHand: 10,
      status: "ACTIVE",
      categoryId: category.id,
      publishedAt: new Date(Date.now() - 86_400_000),
    },
    select: { id: true, slug: true, name: true },
  });
}

/** A paid, not yet handled order, as payment finalization leaves it. */
export async function createPaidOrder(
  lines: Array<{ product: ReviewTestProduct; quantity: number }>,
) {
  const items = lines.map(({ product, quantity }) => ({
    productId: product.id,
    productNameSnapshot: product.name,
    skuSnapshot: `SNAP-${product.id.slice(0, 8)}`,
    quantity,
    unitPriceAmount: 39_900,
    totalPriceAmount: 39_900 * quantity,
    vatRateBasisPoints: 2_500,
  }));
  const total = items.reduce((sum, item) => sum + item.totalPriceAmount, 0);
  return checkoutDb().order.create({
    data: {
      paymentStatus: "PAID",
      paidAt: new Date(),
      email: "recensent@example.com",
      customerName: "Rebecka Recensent",
      addressLine1: "Recensionsvägen 3",
      postalCode: "111 22",
      city: "Stockholm",
      confirmationEmailSentAt: new Date(),
      subtotalAmount: total,
      shippingAmount: 0,
      taxAmount: 0,
      totalAmount: total,
      items: { create: items },
    },
    select: { id: true, items: { select: { id: true, productId: true } } },
  });
}

const run = promisify(execFile);

/** Runs a staff action (see e2e/support/review-actions.ts). */
async function staffAction(...args: string[]): Promise<unknown> {
  const { stdout } = await run(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "e2e/support/review-actions.ts",
      ...args,
    ],
    { env: process.env, timeout: 60_000 },
  );
  return JSON.parse(stdout.trim().split("\n").at(-1)!);
}

/**
 * Marks the order shipped as staff would, lets the outbox send the shipping
 * email, and returns the review link from that email.
 */
export async function shipAndReadReviewLink(
  orderId: string,
  siteUrl: string,
): Promise<string> {
  const outcome = (await staffAction("ship", orderId, siteUrl)) as {
    results: Array<{ ok: boolean }>;
    emails: { outcomes: Record<string, number> };
  };
  expect(outcome.results.every((result) => result.ok)).toBe(true);
  expect(outcome.emails.outcomes).toEqual({ sent: 1 });

  const email = await outboxEmailFor(`order-shipped/${orderId}`);
  expect(email?.to).toBe("recensent@example.com");
  const link = email!.text.match(/https?:\/\/\S+\/review\/[\w-]+/)?.[0];
  expect(link).toBeTruthy();
  expect(email!.html).toContain(link);
  return link!;
}

export async function moderateAsStaff(
  reviewId: string,
  decision: "APPROVE" | "REJECT",
) {
  expect(await staffAction("moderate", reviewId, decision)).toMatchObject({
    ok: true,
  });
}

export async function reviewsFor(productId: string) {
  return checkoutDb().review.findMany({ where: { productId } });
}

/** Removes every review test product with its orders and reviews. */
export async function removeReviewTestData(): Promise<void> {
  const db = checkoutDb();
  const products = await db.product.findMany({
    where: { sku: { startsWith: REVIEW_SKU_PREFIX } },
    select: { id: true },
  });
  const productIds = products.map((product) => product.id);
  if (productIds.length === 0) return;
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
        ],
      },
    }),
    db.review.deleteMany({ where: { productId: { in: productIds } } }),
    db.reviewToken.deleteMany({ where: { orderId: { in: orderIds } } }),
    db.emailDelivery.deleteMany({ where: { orderId: { in: orderIds } } }),
    db.orderItem.deleteMany({ where: { orderId: { in: orderIds } } }),
    db.order.deleteMany({ where: { id: { in: orderIds } } }),
    db.product.deleteMany({ where: { id: { in: productIds } } }),
  ]);
}
