import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { APIRequestContext } from "@playwright/test";
import Stripe from "stripe";

import type { PrismaClient } from "../src/generated/prisma/client";
import { createPrismaClient } from "../src/lib/db/create-client";

import { EMAIL_OUTBOX_DIR } from "./admin-helpers";
import { E2E_STRIPE_STATE_DIR, E2E_WEBHOOK_SECRET } from "./storage-dir";

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
  await rm(E2E_STRIPE_STATE_DIR, { recursive: true, force: true });
  await db.$transaction([
    db.auditLog.deleteMany({
      where: { entityType: "Order", entityId: { in: orderIds } },
    }),
    db.inventoryReservation.deleteMany({
      where: { orderId: { in: orderIds } },
    }),
    db.emailDelivery.deleteMany({ where: { orderId: { in: orderIds } } }),
    db.orderItem.deleteMany({ where: { orderId: { in: orderIds } } }),
    db.order.deleteMany({ where: { id: { in: orderIds } } }),
    db.product.deleteMany({ where: { id: { in: productIds } } }),
  ]);
}

// --- Playing Stripe -----------------------------------------------------------------

type FakeSessionFile = {
  id: string;
  status: string;
  paymentStatus: string;
  paymentIntent: { id: string; status: string; paidAt: string | null } | null;
  customer: Record<string, string | null>;
  shippingAddress: Record<string, string | null> | null;
  [key: string]: unknown;
};

/** Edits what the fake Stripe reports for a session (tests play Stripe). */
export async function patchFakeSession(
  sessionId: string,
  patch: (session: FakeSessionFile) => FakeSessionFile,
) {
  const file = join(E2E_STRIPE_STATE_DIR, `${sessionId}.json`);
  const session = JSON.parse(await readFile(file, "utf8")) as FakeSessionFile;
  await writeFile(file, JSON.stringify(patch(session), null, 2));
}

/** The test customer, as Stripe Checkout would have collected them. */
export const STRIPE_CUSTOMER = {
  shippingName: "Kim Kassatest",
  name: "Kim Kassatest",
  email: "kim.kassatest@example.com",
  phone: "+46700000000",
};
export const STRIPE_ADDRESS = {
  line1: "Kassagatan 7",
  line2: null,
  postalCode: "111 22",
  city: "Stockholm",
  country: "SE",
};

/** The customer pays on Stripe's page (or starts a delayed payment). */
export function payAtStripe(sessionId: string, { async = false } = {}) {
  return patchFakeSession(sessionId, (session) => ({
    ...session,
    status: "complete",
    paymentStatus: async ? "unpaid" : "paid",
    paymentIntent: {
      id: `pi_test_e2e${randomUUID().slice(0, 8)}`,
      status: async ? "processing" : "succeeded",
      paidAt: async ? null : new Date().toISOString(),
    },
    customer: STRIPE_CUSTOMER,
    shippingAddress: STRIPE_ADDRESS,
  }));
}

export function failDelayedPaymentAtStripe(sessionId: string) {
  return patchFakeSession(sessionId, (session) => ({
    ...session,
    paymentIntent: {
      ...session.paymentIntent!,
      status: "requires_payment_method",
    },
  }));
}

export function expireAtStripe(sessionId: string) {
  return patchFakeSession(sessionId, (session) => ({
    ...session,
    status: "expired",
  }));
}

/** Sends a correctly signed Stripe event to the test server's webhook. */
export async function sendStripeEvent(
  request: APIRequestContext,
  type: string,
  sessionId: string,
  { secret = E2E_WEBHOOK_SECRET }: { secret?: string } = {},
) {
  const payload = JSON.stringify({
    id: `evt_e2e_${randomUUID().replaceAll("-", "")}`,
    object: "event",
    type,
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: { object: { id: sessionId, object: "checkout.session" } },
  });
  return request.post("/api/stripe/webhook", {
    headers: {
      "content-type": "application/json",
      "stripe-signature": Stripe.webhooks.generateTestHeaderString({
        payload,
        secret,
      }),
    },
    data: payload,
  });
}

// --- Transactional email (Milestone 10) -------------------------------------------

export type OutboxEmail = {
  id: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string | null;
};

/**
 * The email the test server's file transport wrote for an idempotency key
 * (one file per key, like the provider's deduplication), or null.
 */
export async function outboxEmailFor(
  idempotencyKey: string,
): Promise<OutboxEmail | null> {
  const file = join(
    EMAIL_OUTBOX_DIR,
    `key-${idempotencyKey.replaceAll(/[^A-Za-z0-9-]/g, "_")}.json`,
  );
  try {
    return JSON.parse(await readFile(file, "utf8")) as OutboxEmail;
  } catch {
    return null;
  }
}
