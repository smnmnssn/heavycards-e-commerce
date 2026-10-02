import { randomUUID } from "node:crypto";

import Stripe from "stripe";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/lib/auth/authorization";
import type { CheckoutRequest } from "@/lib/checkout/checkout";
import {
  createMemoryTransport,
  EmailDeliveryError,
  type EmailTransport,
} from "@/lib/email/transport";
import { createCheckout } from "@/server/checkout/create-checkout";
import {
  FAKE_CUSTOMER,
  FAKE_SHIPPING_ADDRESS,
  FakeCheckoutGateway,
} from "@/server/checkout/fake-gateway";
import {
  MAX_ATTEMPTS,
  PROVIDER_IDEMPOTENCY_WINDOW_MS,
  RETRY_DELAYS_MS,
  SEND_LEASE_MS,
} from "@/server/domain/email-delivery";
import {
  dispatchEmailDelivery,
  EMAIL_AUDIT_ACTIONS,
  enqueueMissingOrderConfirmations,
  processDueEmails,
  runEmailJobs,
  type EmailDeps,
} from "@/server/email/outbox";
import { transitionFulfillment } from "@/server/orders/fulfillment";
import { handleReconcileRequest } from "@/server/payments/cron";
import { syncCheckoutSession } from "@/server/payments/session-sync";
import { handleStripeWebhook } from "@/server/payments/webhook";
import { deriveReviewLinkKey } from "@/server/domain/review-token";

import { createAdmin } from "./auth-helpers";
import { createProduct, paidCustomerDetails } from "./factories";
import { createTestDb, resetDatabase } from "./test-database";

/*
 * Milestone 10: transactional email outbox against real PostgreSQL. The
 * memory transport behaves like Resend (a repeated idempotency key returns
 * the first result without delivering again) and records every call, so
 * these tests tell HeavyCards' own guarantees apart from the provider's:
 * `mail.calls` counts requests, `mail.messages` counts delivered emails.
 */

const db = createTestDb();
const SECRET = "whsec_dbtest_signing_secret";
const SITE = "https://heavycards.se";
const REVIEW_KEY = deriveReviewLinkKey("db-test-auth-secret-0123456789abcdef");
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

let gateway: FakeCheckoutGateway;
let mail: ReturnType<typeof createMemoryTransport>;
let now: Date;
let sendOrderEmails: ReturnType<typeof vi.fn<(orderId: string) => void>>;

beforeEach(async () => {
  await resetDatabase(db);
  await db.storeSettings.create({
    data: {
      id: 1,
      storeName: "HeavyCards",
      contactEmail: "kundservice@heavycards.se",
      companyName: "HeavyCards AB",
      shippingPriceAmount: 7_900,
      freeShippingThresholdAmount: 150_000,
      vatRateBasisPoints: 2_500,
      lowStockThreshold: 3,
    },
  });
  gateway = new FakeCheckoutGateway();
  mail = createMemoryTransport();
  now = new Date();
  sendOrderEmails = vi.fn<(orderId: string) => void>();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(() => db.$disconnect());

// --- Helpers ---------------------------------------------------------------------

const emailDeps = (transport: EmailTransport = mail): EmailDeps => ({
  db,
  transport,
  siteUrl: SITE,
  reviewLinkKey: REVIEW_KEY,
  now: () => now,
});

const later = (ms: number) => {
  now = new Date(now.getTime() + ms);
};

const product = (overrides: Parameters<typeof createProduct>[1] = {}) =>
  createProduct(db, {
    publishedAt: new Date(Date.now() - DAY_MS),
    ...overrides,
  });

/** A real checkout (Milestone 8): pending order with snapshots and holds. */
async function checkout(
  lines: Array<{ id: string; price: number; quantity?: number }>,
) {
  const request: CheckoutRequest = {
    attemptId: randomUUID(),
    lines: lines.map(({ id, price, quantity = 1 }) => ({
      productId: id,
      quantity,
      expectedUnitPriceAmount: price,
    })),
  };
  const outcome = await createCheckout(
    { db, gateway, siteUrl: "http://x", now: () => now },
    request,
  );
  if (!outcome.ok)
    throw new Error(`checkout failed: ${JSON.stringify(outcome)}`);
  return { orderId: outcome.orderId, sessionId: outcome.sessionId };
}

function sessionEvent(type: string, sessionId: string, id?: string) {
  const payload = JSON.stringify({
    id: id ?? `evt_m10_${randomUUID().slice(0, 12)}`,
    object: "event",
    api_version: "2026-09-30.endive",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type,
    data: { object: { id: sessionId, object: "checkout.session" } },
  });
  return handleStripeWebhook(
    new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: {
        "stripe-signature": Stripe.webhooks.generateTestHeaderString({
          payload,
          secret: SECRET,
        }),
        "content-type": "application/json",
      },
      body: payload,
    }),
    {
      db,
      gateway,
      webhookSecret: SECRET,
      now: () => now,
      sendOrderEmails,
    },
  );
}

/** Checkout → customer pays → verified webhook. Returns the paid order. */
async function paidOrder({
  quantity = 2,
  price = 49_900,
  customer = {},
}: {
  quantity?: number;
  price?: number;
  customer?: Partial<Record<keyof typeof FAKE_CUSTOMER, string>>;
} = {}) {
  const item = await product({ priceAmount: price, stockOnHand: 10 });
  const { orderId, sessionId } = await checkout([
    { id: item.id, price, quantity },
  ]);
  gateway.completeSession(sessionId, { customer });
  const response = await sessionEvent("checkout.session.completed", sessionId);
  expect(response.status).toBe(200);
  return { orderId, sessionId, product: item };
}

const deliveries = (orderId?: string) =>
  db.emailDelivery.findMany({
    where: orderId ? { orderId } : {},
    orderBy: { createdAt: "asc" },
  });

async function onlyDelivery(orderId: string, kind = "ORDER_CONFIRMATION") {
  const rows = (await deliveries(orderId)).filter((row) => row.kind === kind);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

const order = (orderId: string) =>
  db.order.findUniqueOrThrow({ where: { id: orderId } });

const attentionEntries = () =>
  db.auditLog.findMany({ where: { action: EMAIL_AUDIT_ACTIONS.attention } });

/** A paid order written directly, as Milestone 9 left them: no obligation. */
async function legacyPaidOrder(
  overrides: { confirmationEmailSentAt?: Date; paymentStatus?: string } = {},
) {
  const item = await product();
  return db.order.create({
    data: {
      ...paidCustomerDetails,
      paymentStatus: (overrides.paymentStatus ?? "PAID") as "PAID",
      confirmationEmailSentAt: overrides.confirmationEmailSentAt ?? null,
      refundedAmount: overrides.paymentStatus === "REFUNDED" ? 69_900 : 0,
      subtotalAmount: 69_900,
      shippingAmount: 0,
      taxAmount: 13_980,
      totalAmount: 69_900,
      items: {
        create: {
          productId: item.id,
          productNameSnapshot: item.name,
          skuSnapshot: item.sku,
          quantity: 1,
          unitPriceAmount: 69_900,
          totalPriceAmount: 69_900,
          vatRateBasisPoints: 2_500,
        },
      },
    },
  });
}

// --- The obligation is created with the payment ---------------------------------------

describe("order confirmation obligation", () => {
  it("is created exactly once, in the payment transaction, and nothing is sent inside it", async () => {
    const { orderId } = await paidOrder();

    const delivery = await onlyDelivery(orderId);
    expect(delivery).toMatchObject({
      status: "PENDING",
      attempts: 0,
      sentAt: null,
      providerMessageId: null,
    });
    expect((await order(orderId)).confirmationEmailSentAt).toBeNull();
    // The webhook only hands the order to the outbox for after the response.
    expect(mail.calls).toHaveLength(0);
    expect(sendOrderEmails).toHaveBeenCalledExactlyOnceWith(orderId);
  });

  it("is not duplicated by a redelivered or repeated Stripe success", async () => {
    const { orderId, sessionId } = await paidOrder();
    const eventId = `evt_m10_dup_${randomUUID().slice(0, 8)}`;

    await sessionEvent("checkout.session.completed", sessionId, eventId);
    await sessionEvent("checkout.session.completed", sessionId, eventId);
    await sessionEvent("checkout.session.async_payment_succeeded", sessionId);
    await Promise.all(
      Array.from({ length: 4 }, () =>
        sessionEvent("checkout.session.completed", sessionId),
      ),
    );

    await onlyDelivery(orderId);
    expect(sendOrderEmails).toHaveBeenCalledTimes(1);
    await processDueEmails(emailDeps());
    await processDueEmails(emailDeps());
    expect(mail.calls).toHaveLength(1);
  });

  it("is not duplicated when reconciliation races the webhook", async () => {
    const item = await product({ stockOnHand: 5 });
    const { orderId, sessionId } = await checkout([
      { id: item.id, price: item.priceAmount },
    ]);
    gateway.completeSession(sessionId);

    await Promise.all([
      sessionEvent("checkout.session.completed", sessionId),
      syncCheckoutSession({ db, gateway, now: () => now }, sessionId, {
        source: "reconciliation",
      }),
      sessionEvent("checkout.session.completed", sessionId),
      syncCheckoutSession({ db, gateway, now: () => now }, sessionId, {
        source: "reconciliation",
      }),
    ]);

    expect((await order(orderId)).paymentStatus).toBe("PAID");
    await onlyDelivery(orderId);
    await Promise.all([
      processDueEmails(emailDeps()),
      processDueEmails(emailDeps()),
    ]);
    expect(mail.calls).toHaveLength(1);
  });

  it("rolls back with a payment that is not finalized", async () => {
    const item = await product();
    const mismatch = await checkout([{ id: item.id, price: item.priceAmount }]);
    gateway.completeSession(mismatch.sessionId, { amountTotal: 1 });
    const missingData = await checkout([
      { id: item.id, price: item.priceAmount },
    ]);
    gateway.completeSession(missingData.sessionId, { shippingAddress: null });

    await sessionEvent("checkout.session.completed", mismatch.sessionId);
    await sessionEvent("checkout.session.completed", missingData.sessionId);

    expect((await order(mismatch.orderId)).paymentStatus).toBe("PENDING");
    expect((await order(missingData.orderId)).paymentStatus).toBe("PENDING");
    expect(await deliveries()).toHaveLength(0);
  });

  it("never exists for pending, expired or failed orders, even after a sweep", async () => {
    const item = await product({ stockOnHand: 10 });
    await checkout([{ id: item.id, price: item.priceAmount }]); // stays PENDING
    const expired = await checkout([{ id: item.id, price: item.priceAmount }]);
    gateway.expireAtStripe(expired.sessionId);
    await sessionEvent("checkout.session.expired", expired.sessionId);
    const failed = await checkout([{ id: item.id, price: item.priceAmount }]);
    gateway.completeSession(failed.sessionId, { async: true });
    await sessionEvent("checkout.session.completed", failed.sessionId);
    gateway.settleAsyncPayment(failed.sessionId, false);
    await sessionEvent(
      "checkout.session.async_payment_failed",
      failed.sessionId,
    );

    expect((await order(expired.orderId)).paymentStatus).toBe("EXPIRED");
    expect((await order(failed.orderId)).paymentStatus).toBe("FAILED");
    const summary = await runEmailJobs(emailDeps());

    expect(summary.enqueued).toBe(0);
    expect(await deliveries()).toHaveLength(0);
    expect(mail.calls).toHaveLength(0);
  });
});

// --- Dispatch -------------------------------------------------------------------------

describe("dispatching the confirmation", () => {
  it("sends one Swedish email to the order's own address and records the delivery", async () => {
    const { orderId } = await paidOrder({
      customer: {
        email: "anders.svensson@example.com",
        shippingName: "Anders Svensson",
      },
    });
    const { orderNumber } = await order(orderId);

    const summary = await processDueEmails(emailDeps(), { orderId });

    expect(summary.outcomes).toEqual({ sent: 1 });
    expect(mail.calls).toHaveLength(1);
    const { message, idempotencyKey } = mail.calls[0]!;
    expect(idempotencyKey).toBe(`order-confirmation/${orderId}`);
    expect(message.to).toBe("anders.svensson@example.com");
    expect(message.subject).toBe(`Orderbekräftelse HC-${orderNumber}`);
    expect(message.text).toContain("Hej Anders Svensson,");
    expect(message.replyTo).toBe("kundservice@heavycards.se");

    const delivery = await onlyDelivery(orderId);
    expect(delivery).toMatchObject({
      status: "SENT",
      attempts: 1,
      providerMessageId: "mem_1",
      lockedUntil: null,
      lastError: null,
    });
    expect(delivery.sentAt).toEqual(now);
    expect((await order(orderId)).confirmationEmailSentAt).toEqual(now);
  });

  it("uses the order's snapshots, not current product data", async () => {
    const { product: bought } = await paidOrder({
      quantity: 3,
      price: 149_900,
    });
    await db.product.update({
      where: { id: bought.id },
      data: { name: "Renamed Product", priceAmount: 179_900 },
    });

    await processDueEmails(emailDeps());

    const text = mail.messages[0]!.text.replaceAll(/[  ]/g, " ");
    expect(text).toContain(bought.name);
    expect(text).not.toContain("Renamed Product");
    expect(text).toContain("3 st × 1 499,00 kr = 4 497,00 kr");
    expect(text).not.toContain("1 799");
    // 4 497 kr is above the free-shipping threshold.
    expect(text).toContain("Frakt: Fri frakt");
    expect(text).toContain("Totalt: 4 497,00 kr");
    expect(text).toContain(FAKE_SHIPPING_ADDRESS.line1);
  });

  it("leaves a retryable state when the provider refuses, without touching the order", async () => {
    const { orderId } = await paidOrder();
    mail.queue({
      fail: new EmailDeliveryError("rate_limit_exceeded", "not_sent"),
    });

    expect((await processDueEmails(emailDeps())).outcomes).toEqual({
      retry_scheduled: 1,
    });

    const delivery = await onlyDelivery(orderId);
    expect(delivery).toMatchObject({
      status: "PENDING",
      attempts: 1,
      lastError: "rate_limit_exceeded",
      lockedUntil: null,
      outcomeUnknownSince: null,
    });
    expect(delivery.nextAttemptAt).toEqual(
      new Date(now.getTime() + RETRY_DELAYS_MS[0]!),
    );
    const stored = await order(orderId);
    expect(stored.paymentStatus).toBe("PAID");
    expect(stored.confirmationEmailSentAt).toBeNull();
    expect(await attentionEntries()).toHaveLength(0);

    // Not due yet: nothing happens.
    expect((await processDueEmails(emailDeps())).attempted).toBe(0);
    later(RETRY_DELAYS_MS[0]!);
    expect((await processDueEmails(emailDeps())).outcomes).toEqual({ sent: 1 });
    expect(mail.messages).toHaveLength(1);
    expect(await onlyDelivery(orderId)).toMatchObject({
      status: "SENT",
      attempts: 2,
      lastError: null,
    });
  });

  it("never asks the provider again once SENT", async () => {
    const { orderId } = await paidOrder();
    const { id } = await onlyDelivery(orderId);
    await processDueEmails(emailDeps());

    later(DAY_MS);
    await processDueEmails(emailDeps());
    await runEmailJobs(emailDeps());
    expect(await dispatchEmailDelivery(emailDeps(), id)).toBe("not_claimed");
    expect(await dispatchEmailDelivery(emailDeps(), id)).toBe("not_claimed");

    expect(mail.calls).toHaveLength(1);
  });

  it("retries an unknown outcome with the same key, so a provider timeout never duplicates", async () => {
    const { orderId } = await paidOrder();
    // Resend accepted the email, but the response never arrived.
    mail.queue({
      acceptThenFail: new EmailDeliveryError("timeout", "unknown"),
    });
    const firstAttemptAt = now;

    await processDueEmails(emailDeps());
    expect(await onlyDelivery(orderId)).toMatchObject({
      status: "PENDING",
      lastError: "timeout",
      outcomeUnknownSince: firstAttemptAt,
    });

    later(RETRY_DELAYS_MS[0]!);
    await processDueEmails(emailDeps());

    expect(mail.calls).toHaveLength(2);
    expect(new Set(mail.calls.map((call) => call.idempotencyKey))).toEqual(
      new Set([`order-confirmation/${orderId}`]),
    );
    expect(mail.messages).toHaveLength(1);
    expect(await onlyDelivery(orderId)).toMatchObject({
      status: "SENT",
      providerMessageId: "mem_1",
    });
  });

  it("survives a temporary provider outage and sends exactly once afterwards", async () => {
    const { orderId } = await paidOrder();
    mail.queue(
      { fail: new EmailDeliveryError("network_error", "unknown") },
      { fail: new EmailDeliveryError("internal_server_error", "unknown") },
      { fail: new EmailDeliveryError("timeout", "unknown") },
    );

    for (const delay of [0, ...RETRY_DELAYS_MS.slice(0, 3)]) {
      later(delay);
      await processDueEmails(emailDeps());
    }

    expect(mail.messages).toHaveLength(1);
    expect(await onlyDelivery(orderId)).toMatchObject({
      status: "SENT",
      attempts: 4,
    });
  });

  it("asks a person instead of retrying once the provider may have forgotten the key", async () => {
    const { orderId } = await paidOrder();
    mail.queue({ fail: new EmailDeliveryError("timeout", "unknown") });
    await processDueEmails(emailDeps());

    // No scheduler ran for a day (e.g. a daily cron and no traffic).
    later(PROVIDER_IDEMPOTENCY_WINDOW_MS);
    expect((await processDueEmails(emailDeps())).outcomes).toEqual({
      failed: 1,
    });

    expect(mail.calls).toHaveLength(1);
    expect(await onlyDelivery(orderId)).toMatchObject({
      status: "FAILED",
      lastError: "outcome_unknown",
    });
    const [entry] = await attentionEntries();
    expect(entry).toMatchObject({ adminUserId: null, entityId: orderId });
    expect(entry!.metadata).toMatchObject({
      kind: "ORDER_CONFIRMATION",
      problem: "outcome_unknown",
    });
    later(DAY_MS);
    await runEmailJobs(emailDeps());
    expect(mail.calls).toHaveLength(1);
  });

  it("recovers from a dispatcher that crashed mid-send, reusing the key", async () => {
    const { orderId } = await paidOrder();
    const { id } = await onlyDelivery(orderId);
    const crashedAt = now;
    // A dispatcher claimed the delivery, then the process died.
    await db.emailDelivery.update({
      where: { id },
      data: {
        attempts: 1,
        lastAttemptAt: crashedAt,
        lockedUntil: new Date(crashedAt.getTime() + SEND_LEASE_MS),
      },
    });

    // While the lease holds, nobody else sends.
    expect((await processDueEmails(emailDeps())).attempted).toBe(0);
    later(SEND_LEASE_MS);
    await processDueEmails(emailDeps());

    expect(mail.calls).toHaveLength(1);
    expect(mail.calls[0]!.idempotencyKey).toBe(`order-confirmation/${orderId}`);
    expect(await onlyDelivery(orderId)).toMatchObject({
      status: "SENT",
      attempts: 2,
      outcomeUnknownSince: crashedAt,
    });
  });

  it("stops after the last attempt and flags the order for staff", async () => {
    const { orderId } = await paidOrder();
    mail.queue(
      ...Array.from({ length: MAX_ATTEMPTS }, () => ({
        fail: new EmailDeliveryError("invalid_from_address", "not_sent"),
      })),
    );

    for (const delay of [0, ...RETRY_DELAYS_MS]) {
      later(delay);
      await processDueEmails(emailDeps());
    }
    later(DAY_MS);
    await processDueEmails(emailDeps());

    expect(mail.calls).toHaveLength(MAX_ATTEMPTS);
    expect(await onlyDelivery(orderId)).toMatchObject({
      status: "FAILED",
      attempts: MAX_ATTEMPTS,
      lastError: "invalid_from_address",
    });
    const [entry] = await attentionEntries();
    expect(entry!.metadata).toMatchObject({ problem: "max_attempts" });
    expect((await order(orderId)).paymentStatus).toBe("PAID");
  });

  it("never retries an idempotency conflict", async () => {
    const { orderId } = await paidOrder();
    mail.queue({
      fail: new EmailDeliveryError("invalid_idempotent_request", "conflict"),
    });

    await processDueEmails(emailDeps());
    later(DAY_MS);
    await processDueEmails(emailDeps());

    expect(mail.calls).toHaveLength(1);
    expect(await onlyDelivery(orderId)).toMatchObject({ status: "FAILED" });
  });

  it("sends one email when many dispatchers race for the same delivery", async () => {
    const slow = createMemoryTransport({ delayMs: 50 });
    const { orderId } = await paidOrder();
    const { id } = await onlyDelivery(orderId);

    const [outcomes] = await Promise.all([
      Promise.all(
        Array.from({ length: 8 }, () =>
          dispatchEmailDelivery(emailDeps(slow), id),
        ),
      ),
      processDueEmails(emailDeps(slow)),
      processDueEmails(emailDeps(slow), { orderId }),
      runEmailJobs(emailDeps(slow)),
    ]);

    expect(slow.calls).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome === "sent").length,
    ).toBeLessThanOrEqual(1);
    expect(await onlyDelivery(orderId)).toMatchObject({
      status: "SENT",
      attempts: 1,
    });
  });

  it("does not confirm an order that was fully refunded before the email went out", async () => {
    const { orderId } = await paidOrder();
    const { totalAmount } = await order(orderId);
    await db.order.update({
      where: { id: orderId },
      data: { paymentStatus: "REFUNDED", refundedAmount: totalAmount },
    });

    expect((await processDueEmails(emailDeps())).outcomes).toEqual({
      cancelled: 1,
    });
    expect(mail.calls).toHaveLength(0);
    expect(await onlyDelivery(orderId)).toMatchObject({
      status: "CANCELLED",
      lastError: "order_refunded",
    });
  });

  it("still confirms a partially refunded order", async () => {
    const { orderId } = await paidOrder();
    await db.order.update({
      where: { id: orderId },
      data: { paymentStatus: "PARTIALLY_REFUNDED", refundedAmount: 100 },
    });

    await processDueEmails(emailDeps());

    expect(mail.messages).toHaveLength(1);
  });
});

// --- Orders paid before the outbox existed ---------------------------------------------

describe("paid orders that are missing their confirmation", () => {
  it("are found by the sweep and confirmed once, without another Stripe event", async () => {
    const legacy = await legacyPaidOrder();
    expect(await deliveries()).toHaveLength(0);

    const first = await runEmailJobs(emailDeps());
    const second = await runEmailJobs(emailDeps());

    expect(first).toMatchObject({ enqueued: 1, outcomes: { sent: 1 } });
    expect(second).toMatchObject({ enqueued: 0, attempted: 0 });
    expect(mail.calls).toHaveLength(1);
    expect(mail.messages[0]!.to).toBe(paidCustomerDetails.email);
    expect((await order(legacy.id)).confirmationEmailSentAt).toEqual(now);
  });

  it("concurrent sweeps create one obligation", async () => {
    const legacy = await legacyPaidOrder();

    const counts = await Promise.all(
      Array.from({ length: 5 }, () =>
        enqueueMissingOrderConfirmations(db, { now }),
      ),
    );

    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1);
    await onlyDelivery(legacy.id);
  });

  it("skips orders already confirmed, fully refunded or unpaid", async () => {
    await legacyPaidOrder({ confirmationEmailSentAt: new Date("2026-09-01") });
    await legacyPaidOrder({ paymentStatus: "REFUNDED" });
    const item = await product();
    await checkout([{ id: item.id, price: item.priceAmount }]);

    expect(await enqueueMissingOrderConfirmations(db, { now })).toBe(0);
    expect(await deliveries()).toHaveLength(0);
  });
});

// --- Shipping -------------------------------------------------------------------------

describe("shipping email", () => {
  async function processingOrder() {
    const admin = await createAdmin(db, { role: "ADMIN" });
    const { orderId } = await paidOrder();
    await processDueEmails(emailDeps()); // the confirmation
    mail.calls.length = 0;
    mail.messages.length = 0;
    const result = await transitionFulfillment(db, {
      reviewLinkKey: REVIEW_KEY,
      actorId: admin.id,
      input: { orderId, to: "PROCESSING" },
      now,
    });
    expect(result).toMatchObject({ ok: true, changed: true });
    return { admin, orderId };
  }

  const ship = (actorId: string, orderId: string, extra: object = {}) =>
    transitionFulfillment(db, {
      reviewLinkKey: REVIEW_KEY,
      actorId,
      input: { orderId, to: "SHIPPED", ...extra },
      now,
    });

  it("first SHIPPED: status, shippedAt, audit and exactly one obligation", async () => {
    const { admin, orderId } = await processingOrder();

    const result = await ship(admin.id, orderId, {
      trackingNumber: " RR123456789SE ",
    });

    const delivery = await onlyDelivery(orderId, "ORDER_SHIPPED");
    expect(result).toEqual({
      ok: true,
      changed: true,
      from: "PROCESSING",
      to: "SHIPPED",
      emailDeliveryIds: [delivery.id],
    });
    expect(await order(orderId)).toMatchObject({
      fulfillmentStatus: "SHIPPED",
      shippedAt: now,
      trackingNumber: "RR123456789SE",
      shippingCarrier: "POSTNORD",
      shippingEmailSentAt: null,
    });
    const audit = await db.auditLog.findMany({
      where: { action: "UPDATE_ORDER_STATUS", entityId: orderId },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((entry) => entry.metadata)).toEqual([
      { from: "NEW", to: "PROCESSING" },
      {
        from: "PROCESSING",
        to: "SHIPPED",
        trackingNumber: "RR123456789SE",
        shippingCarrier: "POSTNORD",
      },
    ]);
    expect(audit.every((entry) => entry.adminUserId === admin.id)).toBe(true);
    expect(mail.calls).toHaveLength(0); // sent after the commit, not inside

    await processDueEmails(emailDeps(), { orderId });
    expect(mail.calls).toHaveLength(1);
    const { message, idempotencyKey } = mail.calls[0]!;
    expect(idempotencyKey).toBe(`order-shipped/${orderId}`);
    expect(message.to).toBe(FAKE_CUSTOMER.email);
    expect(message.subject).toMatch(/^Din beställning HC-\d+ har skickats$/);
    expect(message.text).toContain("Spårningsnummer: RR123456789SE");
    expect(message.text).toContain("Fraktbolag: PostNord");
    // Milestone 11: the order's review invitation (tests/db/reviews.test.ts).
    expect(message.text).toMatch(
      /Recensera ditt köp: https:\/\/heavycards\.se\/review\/[\w-]{43}\n/,
    );
    expect((await order(orderId)).shippingEmailSentAt).toEqual(now);
  });

  it("re-saving SHIPPED never sends another email (tracking can be corrected)", async () => {
    const { admin, orderId } = await processingOrder();
    await ship(admin.id, orderId);
    await processDueEmails(emailDeps());

    const again = await ship(admin.id, orderId);
    const corrected = await ship(admin.id, orderId, {
      trackingNumber: "00370712345678901234",
    });
    later(DAY_MS);
    await runEmailJobs(emailDeps());

    expect(again).toMatchObject({
      ok: true,
      changed: false,
      emailDeliveryIds: [],
    });
    expect(corrected).toMatchObject({
      ok: true,
      changed: true,
      emailDeliveryIds: [],
    });
    expect(mail.calls).toHaveLength(1);
    await onlyDelivery(orderId, "ORDER_SHIPPED");
    expect(
      await db.auditLog.count({
        where: { action: "UPDATE_ORDER_TRACKING", entityId: orderId },
      }),
    ).toBe(1);
  });

  it("concurrent SHIPPED submissions create one obligation and one email", async () => {
    const { admin, orderId } = await processingOrder();

    const results = await Promise.all(
      Array.from({ length: 6 }, () => ship(admin.id, orderId)),
    );
    await Promise.all([
      processDueEmails(emailDeps()),
      processDueEmails(emailDeps()),
    ]);

    expect(results.filter((r) => r.ok && r.changed)).toHaveLength(1);
    await onlyDelivery(orderId, "ORDER_SHIPPED");
    expect(mail.calls).toHaveLength(1);
    expect(
      await db.auditLog.count({
        where: { action: "UPDATE_ORDER_STATUS", entityId: orderId },
      }),
    ).toBe(2); // PROCESSING, then SHIPPED once
  });

  it("omits the tracking section without a tracking number", async () => {
    const { admin, orderId } = await processingOrder();
    await ship(admin.id, orderId);
    await processDueEmails(emailDeps());

    const { message } = mail.calls[0]!;
    expect(message.text).not.toContain("Spårningsnummer");
    expect(message.html).not.toContain("Spårningsnummer");
  });

  it("completing a shipped order sends nothing", async () => {
    const { admin, orderId } = await processingOrder();
    await ship(admin.id, orderId);
    await processDueEmails(emailDeps());

    const completed = await transitionFulfillment(db, {
      reviewLinkKey: REVIEW_KEY,
      actorId: admin.id,
      input: { orderId, to: "COMPLETED" },
      now,
    });
    await runEmailJobs(emailDeps());

    expect(completed).toMatchObject({ ok: true, emailDeliveryIds: [] });
    expect(mail.calls).toHaveLength(1);
  });

  it("a mail failure never undoes or blocks the transition", async () => {
    const { admin, orderId } = await processingOrder();
    mail.queue({ fail: new EmailDeliveryError("network_error", "unknown") });

    expect(await ship(admin.id, orderId)).toMatchObject({ ok: true });
    await processDueEmails(emailDeps());

    expect((await order(orderId)).fulfillmentStatus).toBe("SHIPPED");
    expect(await onlyDelivery(orderId, "ORDER_SHIPPED")).toMatchObject({
      status: "PENDING",
      lastError: "network_error",
    });
    later(RETRY_DELAYS_MS[0]!);
    await processDueEmails(emailDeps());
    expect(mail.messages).toHaveLength(1);
  });

  it("refuses invalid transitions, unpaid orders and bad input", async () => {
    const admin = await createAdmin(db, { role: "OWNER" });
    const { orderId } = await paidOrder();
    const item = await product();
    const pending = await checkout([{ id: item.id, price: item.priceAmount }]);

    expect(await ship(admin.id, orderId)).toEqual({
      ok: false,
      error: "INVALID_TRANSITION",
      from: "NEW",
      to: "SHIPPED",
    });
    expect(
      await transitionFulfillment(db, {
        reviewLinkKey: REVIEW_KEY,
        actorId: admin.id,
        input: { orderId: pending.orderId, to: "PROCESSING" },
      }),
    ).toEqual({
      ok: false,
      error: "PAYMENT_NOT_SETTLED",
      paymentStatus: "PENDING",
    });
    expect(
      await transitionFulfillment(db, {
        reviewLinkKey: REVIEW_KEY,
        actorId: admin.id,
        input: { orderId: randomUUID(), to: "PROCESSING" },
      }),
    ).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(
      await transitionFulfillment(db, {
        reviewLinkKey: REVIEW_KEY,
        actorId: admin.id,
        input: { orderId, to: "SHIPPED", trackingNumber: "<script>" },
      }),
    ).toMatchObject({ ok: false, error: "INVALID_INPUT" });
    expect(
      await transitionFulfillment(db, {
        reviewLinkKey: REVIEW_KEY,
        actorId: admin.id,
        input: { orderId, to: "NEW" },
      }),
    ).toMatchObject({ ok: false, error: "INVALID_INPUT" });

    expect((await order(orderId)).fulfillmentStatus).toBe("NEW");
    expect(
      (await deliveries()).filter((row) => row.kind === "ORDER_SHIPPED"),
    ).toHaveLength(0);
  });

  it("refuses an inactive administrator inside the transaction", async () => {
    const inactive = await createAdmin(db, { isActive: false });
    const { orderId } = await paidOrder();

    await expect(
      transitionFulfillment(db, {
        reviewLinkKey: REVIEW_KEY,
        actorId: inactive.id,
        input: { orderId, to: "PROCESSING" },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await order(orderId)).fulfillmentStatus).toBe("NEW");
  });
});

// --- The scheduled run --------------------------------------------------------------

describe("scheduled run", () => {
  const CRON = "cron-secret-for-m10-tests";
  const call = (deps: Partial<Parameters<typeof handleReconcileRequest>[1]>) =>
    handleReconcileRequest(
      new Request("http://localhost/api/cron/reconcile-checkouts", {
        headers: { authorization: `Bearer ${CRON}` },
      }),
      {
        db,
        gateway,
        cronSecret: CRON,
        now: () => now,
        email: emailDeps(),
        ...deps,
      },
    );

  it("an email outage cannot interfere with payment reconciliation", async () => {
    const item = await product({ stockOnHand: 2 });
    const { orderId, sessionId } = await checkout([
      { id: item.id, price: item.priceAmount },
    ]);
    gateway.completeSession(sessionId); // its webhook was lost
    const reservation = await db.inventoryReservation.findFirstOrThrow({
      where: { orderId },
    });
    now = new Date(reservation.expiresAt.getTime() + 1);
    const down: EmailTransport = {
      send: async () => {
        throw new EmailDeliveryError("network_error", "unknown");
      },
    };

    const response = await call({ email: emailDeps(down) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      checked: 1,
      outcomes: { paid: 1 },
      emails: { attempted: 1, outcomes: { retry_scheduled: 1 } },
    });
    expect((await order(orderId)).paymentStatus).toBe("PAID");
    expect(await onlyDelivery(orderId)).toMatchObject({ status: "PENDING" });

    // The next run, with the provider back, confirms it.
    later(RETRY_DELAYS_MS[0]!);
    await call({});
    expect(mail.messages).toHaveLength(1);
  });

  it("still sends due emails when payments are not configured", async () => {
    await legacyPaidOrder();

    const response = await call({ gateway: null });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "not_configured",
      emails: { enqueued: 1, outcomes: { sent: 1 } },
    });
    expect(mail.messages).toHaveLength(1);
  });
});

// --- Privacy ---------------------------------------------------------------------------

describe("logging and audit privacy", () => {
  it("never logs the recipient, the customer's data, the message or a key", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const admin = await createAdmin(db);
    const { orderId } = await paidOrder();
    mail.queue(
      { fail: new EmailDeliveryError("validation_error", "not_sent") },
      { fail: new EmailDeliveryError("timeout", "unknown") },
    );

    await processDueEmails(emailDeps());
    later(RETRY_DELAYS_MS[0]!);
    await processDueEmails(emailDeps());
    later(RETRY_DELAYS_MS[1]!);
    await processDueEmails(emailDeps());
    await transitionFulfillment(db, {
      reviewLinkKey: REVIEW_KEY,
      actorId: admin.id,
      input: { orderId, to: "PROCESSING" },
      now,
    });
    await transitionFulfillment(db, {
      reviewLinkKey: REVIEW_KEY,
      actorId: admin.id,
      input: { orderId, to: "SHIPPED", trackingNumber: "RR1SE" },
      now,
    });
    await processDueEmails(emailDeps());
    await legacyPaidOrder();
    mail.queue({
      fail: new EmailDeliveryError("invalid_idempotent_request", "conflict"),
    });
    await runEmailJobs(emailDeps());

    expect(mail.messages).toHaveLength(2);
    const logged = JSON.stringify([info.mock.calls, error.mock.calls]);
    for (const secret of [
      FAKE_CUSTOMER.email,
      FAKE_CUSTOMER.shippingName,
      FAKE_CUSTOMER.phone,
      FAKE_SHIPPING_ADDRESS.line1,
      paidCustomerDetails.email,
      paidCustomerDetails.customerName,
      "Orderbekräftelse",
      "Hej ",
      SECRET,
    ]) {
      expect(logged).not.toContain(secret);
    }
    expect(logged).toContain("[email] email sent");
    expect(logged).toContain("validation_error");

    const audit = JSON.stringify(
      await db.auditLog.findMany({ select: { metadata: true } }),
    );
    for (const value of [
      FAKE_CUSTOMER.email,
      FAKE_CUSTOMER.shippingName,
      FAKE_SHIPPING_ADDRESS.line1,
      paidCustomerDetails.email,
    ]) {
      expect(audit).not.toContain(value);
    }
  });
});

// --- Schema invariants (migration 20261002120000_transactional_email) ----------------

describe("email_deliveries constraints", () => {
  it("allows one delivery per order and kind, and protects the order", async () => {
    const legacy = await legacyPaidOrder();
    await db.emailDelivery.create({
      data: { orderId: legacy.id, kind: "ORDER_CONFIRMATION" },
    });

    await expect(
      db.emailDelivery.create({
        data: { orderId: legacy.id, kind: "ORDER_CONFIRMATION" },
      }),
    ).rejects.toThrow(/Unique constraint/);
    await db.emailDelivery.create({
      data: { orderId: legacy.id, kind: "ORDER_SHIPPED" },
    });
    await db.orderItem.deleteMany({ where: { orderId: legacy.id } });
    await expect(db.order.delete({ where: { id: legacy.id } })).rejects.toThrow(
      /email_deliveries_order_id_fkey/,
    );
  });

  it.each([
    ["SENT without sent_at", { status: "SENT" }, "email_deliveries_sent_check"],
    [
      "sent_at while pending",
      { sentAt: new Date() },
      "email_deliveries_sent_check",
    ],
    [
      "a lease on a finished delivery",
      { status: "FAILED", lockedUntil: new Date() },
      "email_deliveries_lock_check",
    ],
    [
      "a provider ID without SENT",
      { providerMessageId: "re_x" },
      "email_deliveries_provider_id_check",
    ],
    ["negative attempts", { attempts: -1 }, "email_deliveries_attempts_check"],
  ] as const)("rejects %s", async (_label, data, constraint) => {
    const legacy = await legacyPaidOrder();
    await expect(
      db.emailDelivery.create({
        data: { orderId: legacy.id, kind: "ORDER_CONFIRMATION", ...data },
      }),
    ).rejects.toThrow(constraint);
  });
});
