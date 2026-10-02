import { randomUUID } from "node:crypto";

import Stripe from "stripe";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { CheckoutRequest } from "@/lib/checkout/checkout";
import {
  createCheckout,
  type CheckoutDeps,
} from "@/server/checkout/create-checkout";
import { FakeCheckoutGateway } from "@/server/checkout/fake-gateway";
import { availableToSell } from "@/server/domain/inventory";
import { handleReconcileRequest } from "@/server/payments/cron";
import {
  reconcileCheckouts,
  RECHECK_AFTER_MS,
} from "@/server/payments/reconcile";
import { syncCheckoutSession } from "@/server/payments/session-sync";
import { handleStripeWebhook } from "@/server/payments/webhook";

import { createProduct } from "./factories";
import { createTestDb, resetDatabase } from "./test-database";

const db = createTestDb();
const SECRET = "whsec_dbtest_signing_secret";
const DAY_MS = 24 * 60 * 60 * 1000;

let gateway: FakeCheckoutGateway;
let now: Date;
let revalidate: ReturnType<typeof vi.fn<(slugs: string[]) => void>>;

beforeEach(async () => {
  await resetDatabase(db);
  await db.storeSettings.create({
    data: {
      id: 1,
      storeName: "HeavyCards",
      contactEmail: "kundservice@example.com",
      shippingPriceAmount: 7_900,
      freeShippingThresholdAmount: 150_000,
      vatRateBasisPoints: 2_500,
      lowStockThreshold: 3,
    },
  });
  gateway = new FakeCheckoutGateway();
  now = new Date();
  revalidate = vi.fn<(slugs: string[]) => void>();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(() => db.$disconnect());

// --- Helpers ----------------------------------------------------------------------

const product = (overrides: Parameters<typeof createProduct>[1] = {}) =>
  createProduct(db, {
    publishedAt: new Date(Date.now() - DAY_MS),
    ...overrides,
  });

/** Starts a real checkout (M8) and returns its order and Stripe session. */
async function checkout(
  lines: Array<{ id: string; price: number; quantity?: number }>,
  at = now,
) {
  const request: CheckoutRequest = {
    attemptId: randomUUID(),
    lines: lines.map(({ id, price, quantity = 1 }) => ({
      productId: id,
      quantity,
      expectedUnitPriceAmount: price,
    })),
  };
  const deps: CheckoutDeps = {
    db,
    gateway,
    siteUrl: "http://x",
    now: () => at,
  };
  const outcome = await createCheckout(deps, request);
  if (!outcome.ok)
    throw new Error(`checkout failed: ${JSON.stringify(outcome)}`);
  return { orderId: outcome.orderId, sessionId: outcome.sessionId };
}

let eventSeq = 0;
function signedRequest(
  type: string,
  object: Record<string, unknown>,
  {
    id,
    secret = SECRET,
    timestamp,
  }: { id?: string; secret?: string; timestamp?: number } = {},
) {
  const payload = JSON.stringify({
    id: id ?? `evt_test_${++eventSeq}_${randomUUID().slice(0, 8)}`,
    object: "event",
    api_version: "2026-09-30.endive",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type,
    data: { object },
  });
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret,
    timestamp,
  });
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: {
      "stripe-signature": signature,
      "content-type": "application/json",
    },
    body: payload,
  });
}

const webhookDeps = () => ({
  db,
  gateway,
  webhookSecret: SECRET,
  revalidate,
  now: () => now,
});

async function deliver(
  type: string,
  object: Record<string, unknown>,
  options?: Parameters<typeof signedRequest>[2],
) {
  return handleStripeWebhook(
    signedRequest(type, object, options),
    webhookDeps(),
  );
}

const sessionEvent = (type: string, sessionId: string, id?: string) =>
  deliver(type, { id: sessionId, object: "checkout.session" }, { id });

async function state(orderId: string) {
  return db.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { reservations: true, items: true },
  });
}

async function stock(productId: string) {
  return (await db.product.findUniqueOrThrow({ where: { id: productId } }))
    .stockOnHand;
}

async function available(productId: string, at = now) {
  const row = await db.product.findUniqueOrThrow({
    where: { id: productId },
    include: { reservations: true },
  });
  return availableToSell(row.stockOnHand, row.reservations, at);
}

// --- Webhook security and idempotency ---------------------------------------------

describe("webhook signature verification", () => {
  it("accepts a correctly signed event", async () => {
    const box = await product({ stockOnHand: 3 });
    const { orderId, sessionId } = await checkout([
      { id: box.id, price: box.priceAmount },
    ]);
    gateway.completeSession(sessionId);

    const response = await sessionEvent(
      "checkout.session.completed",
      sessionId,
    );

    expect(response.status).toBe(200);
    expect((await state(orderId)).paymentStatus).toBe("PAID");
  });

  it.each([
    ["a wrong secret", { secret: "whsec_someone_else" }],
    [
      "an old timestamp (replay)",
      { timestamp: Math.floor(Date.now() / 1000) - 3_600 },
    ],
  ])(
    "rejects an event signed with %s and changes nothing",
    async (_label, options) => {
      const box = await product({ stockOnHand: 3 });
      const { orderId, sessionId } = await checkout([
        { id: box.id, price: box.priceAmount },
      ]);
      gateway.completeSession(sessionId);

      const response = await deliver(
        "checkout.session.completed",
        { id: sessionId, object: "checkout.session" },
        options,
      );

      expect(response.status).toBe(400);
      expect((await state(orderId)).paymentStatus).toBe("PENDING");
      expect(await db.stripeEvent.count()).toBe(0);
      expect(gateway.retrieveCalls).toBe(0);
    },
  );

  it("rejects a tampered body and a missing signature", async () => {
    const signed = signedRequest("checkout.session.completed", {
      id: "cs_test_x",
      object: "checkout.session",
    });
    const tampered = new Request(signed.url, {
      method: "POST",
      headers: signed.headers,
      body: (await signed.text()).replace("cs_test_x", "cs_test_y"),
    });
    expect((await handleStripeWebhook(tampered, webhookDeps())).status).toBe(
      400,
    );

    const unsigned = new Request(signed.url, { method: "POST", body: "{}" });
    expect((await handleStripeWebhook(unsigned, webhookDeps())).status).toBe(
      400,
    );
  });

  it("answers 503 (Stripe retries) when the signing secret is not configured", async () => {
    const response = await handleStripeWebhook(
      signedRequest("checkout.session.completed", { id: "cs_test_x" }),
      { ...webhookDeps(), webhookSecret: null },
    );
    expect(response.status).toBe(503);
  });

  it("never logs the payload, signature or secret", async () => {
    const errorSpy = vi.mocked(console.error);
    await deliver(
      "checkout.session.completed",
      { id: "cs_test_zz" },
      { secret: "whsec_wrong" },
    );
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain("cs_test_zz");
    expect(logged).not.toContain("v1=");
  });
});

describe("unknown and unrelated events", () => {
  it("acknowledges and records events HeavyCards does not act on", async () => {
    const response = await deliver("customer.created", {
      id: "cus_1",
      object: "customer",
    });

    expect(response.status).toBe(200);
    expect(await db.stripeEvent.count()).toBe(1);
  });

  it("ignores sessions that are not HeavyCards checkouts without asking Stripe", async () => {
    const response = await sessionEvent(
      "checkout.session.completed",
      "cs_test_notours",
    );

    expect(response.status).toBe(200);
    expect(gateway.retrieveCalls).toBe(0);
    expect(await db.order.count()).toBe(0);
  });
});

describe("duplicate and concurrent deliveries", () => {
  it("processes a redelivered event once: stock and reservations change exactly once", async () => {
    const box = await product({ stockOnHand: 5 });
    const { orderId, sessionId } = await checkout([
      { id: box.id, price: box.priceAmount, quantity: 2 },
    ]);
    gateway.completeSession(sessionId);

    const first = await sessionEvent(
      "checkout.session.completed",
      sessionId,
      "evt_dup_1",
    );
    const second = await sessionEvent(
      "checkout.session.completed",
      sessionId,
      "evt_dup_1",
    );

    expect(first.status).toBe(200);
    expect(await second.json()).toEqual({ received: true, duplicate: true });
    expect(await stock(box.id)).toBe(3);
    expect(await db.stripeEvent.count()).toBe(1);
    expect((await state(orderId)).reservations.map((r) => r.status)).toEqual([
      "CONSUMED",
    ]);
  });

  it("processes simultaneous duplicate deliveries once", async () => {
    const box = await product({ stockOnHand: 5 });
    const { sessionId } = await checkout([
      { id: box.id, price: box.priceAmount, quantity: 2 },
    ]);
    gateway.completeSession(sessionId);

    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        sessionEvent("checkout.session.completed", sessionId, "evt_race_1"),
      ),
    );

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(await stock(box.id)).toBe(3);
    expect(await db.stripeEvent.count()).toBe(1);
    expect(
      await db.auditLog.count({ where: { action: "MARK_ORDER_PAID" } }),
    ).toBe(1);
  });

  it("applies different events about the same payment (and reconciliation) once", async () => {
    const box = await product({ stockOnHand: 5 });
    const { sessionId } = await checkout([
      { id: box.id, price: box.priceAmount, quantity: 2 },
    ]);
    gateway.completeSession(sessionId);

    await Promise.all([
      sessionEvent("checkout.session.completed", sessionId),
      sessionEvent("checkout.session.async_payment_succeeded", sessionId),
      syncCheckoutSession({ db, gateway }, sessionId, {
        source: "reconciliation",
      }),
    ]);

    expect(await stock(box.id)).toBe(3);
    expect(await db.stripeEvent.count()).toBe(2);
  });

  it("answers 500 without recording the event when Stripe is unreachable, then succeeds on retry", async () => {
    const box = await product({ stockOnHand: 1 });
    const { orderId, sessionId } = await checkout([
      { id: box.id, price: box.priceAmount },
    ]);
    gateway.completeSession(sessionId);
    gateway.unavailable = true;

    const failed = await sessionEvent(
      "checkout.session.completed",
      sessionId,
      "evt_retry",
    );
    expect(failed.status).toBe(500);
    expect(await db.stripeEvent.count()).toBe(0);
    expect(await available(box.id)).toBe(0); // still reserved

    gateway.unavailable = false;
    const retried = await sessionEvent(
      "checkout.session.completed",
      sessionId,
      "evt_retry",
    );
    expect(retried.status).toBe(200);
    expect((await state(orderId)).paymentStatus).toBe("PAID");
  });
});

// --- Paid-order finalization -------------------------------------------------------

describe("paid-order finalization", () => {
  it("finalizes once: stock, reservations, customer data, identifiers and audit", async () => {
    const box = await product({
      name: "Booster Box",
      stockOnHand: 4,
      priceAmount: 219_900,
    });
    const pack = await product({
      name: "Booster Pack",
      stockOnHand: 50,
      priceAmount: 6_900,
    });
    const { orderId, sessionId } = await checkout([
      { id: box.id, price: 219_900, quantity: 2 },
      { id: pack.id, price: 6_900, quantity: 3 },
    ]);
    const paidAt = new Date("2026-10-02T10:15:00Z");
    gateway.completeSession(sessionId, {
      paidAt,
      customer: {
        shippingName: "  Anna-Karin von Essen Lindqvist ",
        email: "anna@example.com",
        phone: "+46701740605",
      },
      shippingAddress: {
        line1: "Storgatan 1",
        line2: "lgh 1102",
        postalCode: "111 22",
        city: "Stockholm",
      },
    });

    const response = await sessionEvent(
      "checkout.session.completed",
      sessionId,
    );

    expect(response.status).toBe(200);
    const order = await state(orderId);
    expect(order).toMatchObject({
      paymentStatus: "PAID",
      fulfillmentStatus: "NEW",
      paidAt,
      stripeCheckoutSessionId: sessionId,
      stripePaymentIntentId: gateway.session(sessionId)!.paymentIntent!.id,
      // One full name exactly as entered (outer whitespace removed), never split.
      customerName: "Anna-Karin von Essen Lindqvist",
      email: "anna@example.com",
      phone: "+46701740605",
      addressLine1: "Storgatan 1",
      addressLine2: "lgh 1102",
      postalCode: "111 22",
      city: "Stockholm",
      country: "SE",
      refundedAmount: 0,
      confirmationEmailSentAt: null, // emails are Milestone 10
    });
    expect(order.reservations.every((r) => r.status === "CONSUMED")).toBe(true);
    expect(await stock(box.id)).toBe(2);
    expect(await stock(pack.id)).toBe(47);

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: "MARK_ORDER_PAID" },
    });
    expect(audit).toMatchObject({
      adminUserId: null,
      entityType: "Order",
      entityId: orderId,
    });
    expect(JSON.stringify(audit.metadata)).not.toMatch(/Anna|Storgatan|anna@/);

    expect(revalidate).toHaveBeenCalledWith(
      expect.arrayContaining([box.slug, pack.slug]),
    );
  });

  it("replaying a success event later changes nothing", async () => {
    const box = await product({ stockOnHand: 3 });
    const { orderId, sessionId } = await checkout([
      { id: box.id, price: box.priceAmount },
    ]);
    gateway.completeSession(sessionId);
    await sessionEvent("checkout.session.completed", sessionId);
    const before = await state(orderId);

    await sessionEvent("checkout.session.completed", sessionId);
    await sessionEvent("checkout.session.async_payment_succeeded", sessionId);

    expect(await state(orderId)).toEqual(before);
    expect(await stock(box.id)).toBe(2);
  });

  it.each([
    ["amount", { amountTotal: 1 }, "amount_mismatch"],
    ["currency", { currency: "eur" }, "currency_mismatch"],
  ] as const)(
    "a %s mismatch blocks finalization and keeps stock reserved",
    async (_label, change, problem) => {
      const box = await product({ stockOnHand: 1 });
      const { orderId, sessionId } = await checkout([
        { id: box.id, price: box.priceAmount },
      ]);
      gateway.completeSession(sessionId, change);

      await sessionEvent("checkout.session.completed", sessionId);
      await sessionEvent("checkout.session.completed", sessionId); // again

      const order = await state(orderId);
      expect(order.paymentStatus).toBe("PENDING");
      expect(order.reservations[0]!.status).toBe("ACTIVE");
      expect(await stock(box.id)).toBe(1);
      expect(await available(box.id)).toBe(0);
      const flags = await db.auditLog.findMany({
        where: { action: "PAYMENT_NEEDS_ATTENTION" },
      });
      expect(flags).toHaveLength(1); // recorded once, not per delivery
      expect(flags[0]!.metadata).toMatchObject({ problem });
    },
  );

  it.each([
    ["no shipping address", { shippingAddress: null }],
    ["a blank name", { customer: { shippingName: " ", name: null } }],
    ["no email", { customer: { email: null } }],
    ["no postal code", { shippingAddress: { postalCode: null } }],
    ["an address outside Sweden", { shippingAddress: { country: "NO" } }],
  ])(
    "missing or invalid customer data (%s) never creates a malformed paid order",
    async (_label, change) => {
      const box = await product({ stockOnHand: 1 });
      const { orderId, sessionId } = await checkout([
        { id: box.id, price: box.priceAmount },
      ]);
      gateway.completeSession(sessionId, change as never);

      const response = await sessionEvent(
        "checkout.session.completed",
        sessionId,
      );

      expect(response.status).toBe(200); // recorded; a retry would not fix it
      const order = await state(orderId);
      expect(order.paymentStatus).toBe("PENDING");
      expect(order.customerName).toBeNull();
      expect(order.reservations[0]!.status).toBe("ACTIVE");
      expect(
        await db.auditLog.findFirst({
          where: { action: "PAYMENT_NEEDS_ATTENTION" },
        }),
      ).toMatchObject({
        metadata: expect.objectContaining({ problem: "missing_customer_data" }),
      });
    },
  );

  it("stores no phone when Stripe collected none", async () => {
    const box = await product();
    const { orderId, sessionId } = await checkout([
      { id: box.id, price: box.priceAmount },
    ]);
    gateway.completeSession(sessionId, { customer: { phone: null } });

    await sessionEvent("checkout.session.completed", sessionId);

    expect(await state(orderId)).toMatchObject({
      paymentStatus: "PAID",
      phone: null,
    });
  });

  it("records a paid order even if stock was lowered below the reservation meanwhile", async () => {
    const box = await product({ stockOnHand: 2 });
    const { orderId, sessionId } = await checkout([
      { id: box.id, price: box.priceAmount, quantity: 2 },
    ]);
    await db.product.update({
      where: { id: box.id },
      data: { stockOnHand: 1 },
    });
    gateway.completeSession(sessionId);

    await sessionEvent("checkout.session.completed", sessionId);

    expect((await state(orderId)).paymentStatus).toBe("PAID");
    expect(await stock(box.id)).toBe(0);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: "MARK_ORDER_PAID" },
    });
    expect(audit.metadata).toMatchObject({
      stockShortfalls: [{ productId: box.id, missing: 1 }],
    });
  });
});

// --- Expiry, async payments and ordering ------------------------------------------

describe("checkout expiration", () => {
  it("releases stock and marks the order EXPIRED when Stripe reports expiry", async () => {
    const box = await product({ stockOnHand: 1 });
    const { orderId, sessionId } = await checkout([
      { id: box.id, price: box.priceAmount },
    ]);
    gateway.expireAtStripe(sessionId);

    await sessionEvent("checkout.session.expired", sessionId);
    await sessionEvent("checkout.session.expired", sessionId); // another delivery

    const order = await state(orderId);
    expect(order.paymentStatus).toBe("EXPIRED");
    expect(order.paidAt).toBeNull();
    expect(order.reservations[0]!.status).toBe("RELEASED");
    expect(await stock(box.id)).toBe(1);
    expect(await available(box.id)).toBe(1);
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it("a late expiry event never touches a paid order", async () => {
    const box = await product({ stockOnHand: 2 });
    const { orderId, sessionId } = await checkout([
      { id: box.id, price: box.priceAmount },
    ]);
    gateway.completeSession(sessionId);
    await sessionEvent("checkout.session.completed", sessionId);

    await sessionEvent("checkout.session.expired", sessionId);
    // Even if Stripe's state looked expired (it cannot after payment).
    gateway.expireAtStripe(sessionId);
    await sessionEvent("checkout.session.expired", sessionId);

    expect((await state(orderId)).paymentStatus).toBe("PAID");
    expect(await stock(box.id)).toBe(1);
  });
});

describe("delayed (asynchronous) payment methods", () => {
  it("keeps stock reserved while the payment settles, then finalizes once", async () => {
    const box = await product({ stockOnHand: 1 });
    const { orderId, sessionId } = await checkout([
      { id: box.id, price: box.priceAmount },
    ]);
    gateway.completeSession(sessionId, { async: true });

    await sessionEvent("checkout.session.completed", sessionId);
    let order = await state(orderId);
    expect(order.paymentStatus).toBe("PENDING");
    expect(order.stripePaymentIntentId).toBe(
      gateway.session(sessionId)!.paymentIntent!.id,
    );
    expect(order.reservations[0]).toMatchObject({
      status: "ACTIVE",
      awaitingPayment: true,
    });
    expect(await available(box.id, new Date(now.getTime() + 30 * DAY_MS))).toBe(
      0,
    );

    gateway.settleAsyncPayment(sessionId, true);
    await sessionEvent("checkout.session.async_payment_succeeded", sessionId);
    order = await state(orderId);
    expect(order.paymentStatus).toBe("PAID");
    expect(await stock(box.id)).toBe(0);
  });

  it("releases stock and marks the order FAILED when the delayed payment fails", async () => {
    const box = await product({ stockOnHand: 1 });
    const { orderId, sessionId } = await checkout([
      { id: box.id, price: box.priceAmount },
    ]);
    gateway.completeSession(sessionId, { async: true });
    await sessionEvent("checkout.session.completed", sessionId);
    gateway.settleAsyncPayment(sessionId, false);

    await sessionEvent("checkout.session.async_payment_failed", sessionId);
    // A stale "completed" replay cannot revive it.
    await sessionEvent("checkout.session.completed", sessionId);

    const order = await state(orderId);
    expect(order.paymentStatus).toBe("FAILED");
    expect(order.reservations[0]!.status).toBe("RELEASED");
    expect(await stock(box.id)).toBe(1);
    expect(await available(box.id)).toBe(1);
    expect(
      await db.auditLog.count({
        where: { action: "MARK_ORDER_PAYMENT_FAILED" },
      }),
    ).toBe(1);
  });

  it("an open session (the customer only left Checkout) changes nothing", async () => {
    const box = await product({ stockOnHand: 1 });
    const { orderId, sessionId } = await checkout([
      { id: box.id, price: box.priceAmount },
    ]);

    await syncCheckoutSession({ db, gateway }, sessionId, {
      source: "reconciliation",
    });

    expect((await state(orderId)).paymentStatus).toBe("PENDING");
    expect(await available(box.id)).toBe(0);
  });
});

// --- Refunds -----------------------------------------------------------------------

describe("refund synchronization", () => {
  async function paidOrder(stockOnHand = 3) {
    const box = await product({ stockOnHand, priceAmount: 10_000 });
    const { orderId, sessionId } = await checkout([
      { id: box.id, price: 10_000, quantity: 2 },
    ]);
    gateway.completeSession(sessionId);
    await sessionEvent("checkout.session.completed", sessionId);
    const paymentIntentId = gateway.session(sessionId)!.paymentIntent!.id;
    // 2 × 100 kr + 79 kr shipping = 279 kr
    return { box, orderId, sessionId, paymentIntentId };
  }
  const refundEvent = (type: string, paymentIntentId: string, id?: string) =>
    deliver(
      type,
      {
        id: `re_${randomUUID().slice(0, 6)}`,
        object: "refund",
        payment_intent: paymentIntentId,
      },
      { id },
    );
  const refundAudits = () =>
    db.auditLog.count({ where: { action: "SYNC_ORDER_REFUND" } });

  it("a successful partial refund → PARTIALLY_REFUNDED, a successful full refund → REFUNDED, never restocking", async () => {
    const { box, orderId, sessionId, paymentIntentId } = await paidOrder();
    const stockAfterPayment = await stock(box.id);

    gateway.addRefund(sessionId, 10_000, "succeeded");
    await refundEvent("refund.created", paymentIntentId);
    expect(await state(orderId)).toMatchObject({
      paymentStatus: "PARTIALLY_REFUNDED",
      refundedAmount: 10_000,
    });

    gateway.addRefund(sessionId, 17_900, "succeeded");
    await deliver("charge.refunded", {
      id: "ch_1",
      object: "charge",
      payment_intent: paymentIntentId,
    });
    expect(await state(orderId)).toMatchObject({
      paymentStatus: "REFUNDED",
      refundedAmount: 27_900,
    });

    expect(await stock(box.id)).toBe(stockAfterPayment);
    expect(revalidate).toHaveBeenCalledTimes(1); // only the payment itself
    expect(await refundAudits()).toBe(2);
  });

  it.each(["pending", "requires_action"] as const)(
    "a %s refund changes neither status nor refunded amount",
    async (status) => {
      const { orderId, sessionId, paymentIntentId } = await paidOrder();

      gateway.addRefund(sessionId, 27_900, status);
      await refundEvent("refund.created", paymentIntentId);
      await deliver("charge.refunded", {
        id: "ch_1",
        object: "charge",
        payment_intent: paymentIntentId,
      });

      expect(await state(orderId)).toMatchObject({
        paymentStatus: "PAID",
        refundedAmount: 0,
      });
      expect(await refundAudits()).toBe(0);
    },
  );

  it("a pending refund counts once Stripe reports it succeeded", async () => {
    const { orderId, sessionId, paymentIntentId } = await paidOrder();
    const refundId = gateway.addRefund(sessionId, 10_000, "pending");
    await refundEvent("refund.created", paymentIntentId);
    expect((await state(orderId)).paymentStatus).toBe("PAID");

    gateway.setRefundStatus(sessionId, refundId, "succeeded");
    await refundEvent("refund.updated", paymentIntentId);

    expect(await state(orderId)).toMatchObject({
      paymentStatus: "PARTIALLY_REFUNDED",
      refundedAmount: 10_000,
    });
    expect(await refundAudits()).toBe(1);
  });

  it.each([
    ["requires_action", "canceled", "refund.updated"],
    ["pending", "failed", "refund.failed"],
  ] as const)(
    "a %s refund that ends %s never touched the order",
    async (initial, final, event) => {
      const { orderId, sessionId, paymentIntentId } = await paidOrder();
      const refundId = gateway.addRefund(sessionId, 27_900, initial);
      await refundEvent("refund.created", paymentIntentId);
      expect(await state(orderId)).toMatchObject({
        paymentStatus: "PAID",
        refundedAmount: 0,
      });

      gateway.setRefundStatus(sessionId, refundId, final);
      await refundEvent(event, paymentIntentId);

      expect(await state(orderId)).toMatchObject({
        paymentStatus: "PAID",
        refundedAmount: 0,
      });
      expect(await refundAudits()).toBe(0);
    },
  );

  it("counts only the succeeded refunds when succeeded and pending ones are mixed", async () => {
    const { orderId, sessionId, paymentIntentId } = await paidOrder();
    gateway.addRefund(sessionId, 5_000, "succeeded");
    gateway.addRefund(sessionId, 7_000, "pending");
    gateway.addRefund(sessionId, 3_000, "requires_action");
    gateway.addRefund(sessionId, 2_000, "failed");
    gateway.addRefund(sessionId, 1_000, "canceled");

    await refundEvent("refund.created", paymentIntentId);

    expect(await state(orderId)).toMatchObject({
      paymentStatus: "PARTIALLY_REFUNDED",
      refundedAmount: 5_000,
    });
  });

  it("replayed and reordered refund events converge on Stripe's current succeeded amount", async () => {
    const { orderId, sessionId, paymentIntentId } = await paidOrder();
    gateway.addRefund(sessionId, 27_900, "succeeded");

    await refundEvent("refund.created", paymentIntentId, "evt_refund_a");
    const redelivery = await refundEvent(
      "refund.created",
      paymentIntentId,
      "evt_refund_a",
    );
    await refundEvent("refund.updated", paymentIntentId); // older event, later
    await refundEvent("charge.refunded", paymentIntentId);

    expect(await redelivery.json()).toEqual({
      received: true,
      duplicate: true,
    });
    expect(await state(orderId)).toMatchObject({
      paymentStatus: "REFUNDED",
      refundedAmount: 27_900,
    });
    expect(await refundAudits()).toBe(1);
  });

  it("a succeeded refund that later fails lowers the refunded amount again", async () => {
    const { orderId, sessionId, paymentIntentId } = await paidOrder();
    const refundId = gateway.addRefund(sessionId, 27_900, "succeeded");
    await refundEvent("refund.created", paymentIntentId);
    expect((await state(orderId)).paymentStatus).toBe("REFUNDED");

    gateway.setRefundStatus(sessionId, refundId, "failed");
    await refundEvent("refund.failed", paymentIntentId);

    expect(await state(orderId)).toMatchObject({
      paymentStatus: "PAID",
      refundedAmount: 0,
    });
  });

  it("a refunded order never reverts because an old success event is replayed", async () => {
    const { orderId, sessionId, paymentIntentId } = await paidOrder();
    gateway.addRefund(sessionId, 27_900, "succeeded");
    await refundEvent("refund.created", paymentIntentId);

    await sessionEvent("checkout.session.completed", sessionId);

    expect((await state(orderId)).paymentStatus).toBe("REFUNDED");
  });

  it("a refund arriving before the payment event finalizes the payment first", async () => {
    const box = await product({ stockOnHand: 3, priceAmount: 10_000 });
    const { orderId, sessionId } = await checkout([
      { id: box.id, price: 10_000 },
    ]);
    gateway.completeSession(sessionId);
    gateway.addRefund(sessionId, 5_000, "succeeded");

    await refundEvent(
      "refund.created",
      gateway.session(sessionId)!.paymentIntent!.id,
    );

    expect(await state(orderId)).toMatchObject({
      paymentStatus: "PARTIALLY_REFUNDED",
      refundedAmount: 5_000,
    });
    expect(await stock(box.id)).toBe(2);
  });

  it("ignores refunds for payments HeavyCards does not know", async () => {
    const response = await refundEvent("refund.created", "pi_unknown");
    expect(response.status).toBe(200);
    expect(await db.stripeEvent.count()).toBe(1);
  });
});

// --- Delayed webhooks and reconciliation -------------------------------------------

describe("delayed webhooks and reconciliation", () => {
  it("a payment whose webhook arrives after the reservation's expiry is never oversold", async () => {
    const box = await product({ stockOnHand: 1 });
    const { orderId, sessionId } = await checkout([
      { id: box.id, price: box.priceAmount },
    ]);
    // The customer pays in time, but Stripe's webhook is delayed for hours.
    gateway.completeSession(sessionId);
    const reservation = (await state(orderId)).reservations[0]!;
    const muchLater = new Date(
      reservation.expiresAt.getTime() + 6 * 60 * 60 * 1000,
    );

    // Meanwhile another customer tries to buy the last unit.
    const rival = await createCheckout(
      { db, gateway, siteUrl: "http://x", now: () => muchLater },
      {
        attemptId: randomUUID(),
        lines: [
          {
            productId: box.id,
            quantity: 1,
            expectedUnitPriceAmount: box.priceAmount,
          },
        ],
      },
    );
    expect(rival).toMatchObject({
      ok: false,
      code: "rejected",
      issues: [{ kind: "unavailable", reason: "sold_out" }],
    });
    expect(await available(box.id, muchLater)).toBe(0);

    now = muchLater;
    await sessionEvent("checkout.session.completed", sessionId);

    expect((await state(orderId)).paymentStatus).toBe("PAID");
    expect(await stock(box.id)).toBe(0);
    expect(await db.order.count()).toBe(1);
  });

  it("finalizes a paid checkout whose webhook never arrived", async () => {
    const box = await product({ stockOnHand: 2 });
    const { orderId, sessionId } = await checkout([
      { id: box.id, price: box.priceAmount },
    ]);
    gateway.completeSession(sessionId);
    const due = new Date(
      (await state(orderId)).reservations[0]!.expiresAt.getTime() + 1,
    );

    const summary = await reconcileCheckouts({ db, gateway, now: () => due });

    expect(summary).toMatchObject({
      checked: 1,
      outcomes: { paid: 1 },
      productSlugs: [box.slug],
    });
    expect((await state(orderId)).paymentStatus).toBe("PAID");
    expect(await stock(box.id)).toBe(1);
  });

  it("releases stock of a missed expiration, and running again changes nothing", async () => {
    const box = await product({ stockOnHand: 1 });
    const { orderId, sessionId } = await checkout([
      { id: box.id, price: box.priceAmount },
    ]);
    gateway.expireAtStripe(sessionId);
    const due = new Date(
      (await state(orderId)).reservations[0]!.expiresAt.getTime() + 1,
    );
    expect(await available(box.id, due)).toBe(0); // until Stripe is asked

    const first = await reconcileCheckouts({ db, gateway, now: () => due });
    const second = await reconcileCheckouts({ db, gateway, now: () => due });

    expect(first.outcomes).toEqual({ expired: 1 });
    expect(second.checked).toBe(0);
    expect((await state(orderId)).paymentStatus).toBe("EXPIRED");
    expect(await available(box.id, due)).toBe(1);
    expect(await stock(box.id)).toBe(1);
  });

  it("keeps stock reserved when Stripe is unavailable, retries later, then resolves", async () => {
    const box = await product({ stockOnHand: 1 });
    const { orderId, sessionId } = await checkout([
      { id: box.id, price: box.priceAmount },
    ]);
    gateway.expireAtStripe(sessionId);
    const due = new Date(
      (await state(orderId)).reservations[0]!.expiresAt.getTime() + 1,
    );
    gateway.unavailable = true;

    const failed = await reconcileCheckouts({ db, gateway, now: () => due });

    expect(failed.outcomes).toEqual({ error: 1 });
    const held = (await state(orderId)).reservations[0]!;
    expect(held).toMatchObject({ status: "ACTIVE", awaitingPayment: true });
    expect(held.expiresAt.getTime()).toBe(due.getTime() + RECHECK_AFTER_MS);
    expect(await available(box.id, due)).toBe(0);
    // Not checked again before the postponed time.
    expect(
      (await reconcileCheckouts({ db, gateway, now: () => due })).checked,
    ).toBe(0);

    gateway.unavailable = false;
    const later = new Date(due.getTime() + RECHECK_AFTER_MS);
    const resolved = await reconcileCheckouts({
      db,
      gateway,
      now: () => later,
    });
    expect(resolved.outcomes).toEqual({ expired: 1 });
    expect(await available(box.id, later)).toBe(1);
  });

  it("postpones a delayed payment that is still settling, keeping the stock", async () => {
    const box = await product({ stockOnHand: 1 });
    const { orderId, sessionId } = await checkout([
      { id: box.id, price: box.priceAmount },
    ]);
    gateway.completeSession(sessionId, { async: true });
    const due = new Date(
      (await state(orderId)).reservations[0]!.expiresAt.getTime() + 1,
    );

    const summary = await reconcileCheckouts({ db, gateway, now: () => due });

    expect(summary.outcomes).toEqual({ processing: 1 });
    expect(await available(box.id, due)).toBe(0);
  });

  it("only checks attached checkouts whose expiry has passed", async () => {
    const box = await product({ stockOnHand: 5 });
    await checkout([{ id: box.id, price: box.priceAmount }]);

    expect(
      (await reconcileCheckouts({ db, gateway, now: () => now })).checked,
    ).toBe(0);
    expect(gateway.retrieveCalls).toBe(0);
  });

  it("reconciliation and a late webhook racing finalize once", async () => {
    const box = await product({ stockOnHand: 3 });
    const { orderId, sessionId } = await checkout([
      { id: box.id, price: box.priceAmount, quantity: 2 },
    ]);
    gateway.completeSession(sessionId);
    const due = new Date(
      (await state(orderId)).reservations[0]!.expiresAt.getTime() + 1,
    );
    now = due;

    await Promise.all([
      reconcileCheckouts({ db, gateway, now: () => due }),
      sessionEvent("checkout.session.completed", sessionId),
      reconcileCheckouts({ db, gateway, now: () => due }),
    ]);

    expect(await stock(box.id)).toBe(1);
    expect(
      await db.auditLog.count({ where: { action: "MARK_ORDER_PAID" } }),
    ).toBe(1);
  });
});

describe("GET /api/cron/reconcile-checkouts", () => {
  const CRON = "cron-secret-for-db-tests";
  const call = (authorization?: string, cronSecret: string | null = CRON) =>
    handleReconcileRequest(
      new Request("http://localhost/api/cron/reconcile-checkouts", {
        headers: authorization ? { authorization } : {},
      }),
      { db, gateway, cronSecret, revalidate, now: () => now },
    );

  it.each([
    ["no header", undefined],
    ["a wrong secret", "Bearer nope"],
    ["the secret without Bearer", CRON],
  ])("refuses %s", async (_label, header) => {
    expect((await call(header)).status).toBe(401);
  });

  it("refuses everything when no secret is configured", async () => {
    expect((await call("Bearer ", null)).status).toBe(401);
  });

  it("reconciles and reports a summary without personal data", async () => {
    const box = await product({ stockOnHand: 1 });
    const { orderId, sessionId } = await checkout([
      { id: box.id, price: box.priceAmount },
    ]);
    gateway.expireAtStripe(sessionId);
    now = new Date(
      (await state(orderId)).reservations[0]!.expiresAt.getTime() + 1,
    );

    const response = await call(`Bearer ${CRON}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      checked: 1,
      outcomes: { expired: 1 },
      provisionalReleased: 0,
      // Milestone 14: expired security data is pruned in the same run.
      housekeeping: {
        rateLimitBuckets: 0,
        authRateLimits: 0,
        adminSessions: 0,
        authVerifications: 0,
      },
    });
    expect(revalidate).toHaveBeenCalledWith([box.slug]);
  });
});
