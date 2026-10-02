import { randomUUID } from "node:crypto";

import { verifyPassword } from "better-auth/crypto";
import Stripe from "stripe";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/lib/auth/authorization";
import { createMemoryTransport } from "@/lib/email/transport";
import { createCheckout } from "@/server/checkout/create-checkout";
import {
  FakeCheckoutGateway,
  type FakeSession,
} from "@/server/checkout/fake-gateway";
import { deriveReviewLinkKey } from "@/server/domain/review-token";
import { availableToSell } from "@/server/domain/inventory";
import { processDueEmails, type EmailDeps } from "@/server/email/outbox";
import { requeueFailedEmail } from "@/server/operations/email-requeue";
import { authenticateOwner } from "@/server/operations/operator-auth";
import {
  assessPaymentHold,
  releasePaymentHold,
} from "@/server/operations/payment-hold";
import { handleStripeWebhook } from "@/server/payments/webhook";
import { clientKey } from "@/server/security/rate-limit";

import { createAdmin, randomPassword } from "./auth-helpers";
import { createProduct } from "./factories";
import { createTestDb, resetDatabase } from "./test-database";

/*
 * Milestone 14 operator procedures (scripts/operator.ts): releasing a hold
 * Stripe and HeavyCards cannot reconcile, only on Stripe's proof that the
 * money went back; and requeueing a FAILED email after a person checked
 * Resend. Both are OWNER-only and audited.
 */

const db = createTestDb();
const WEBHOOK_SECRET = "whsec_dbtest_signing_secret";
const SITE = "https://heavycards.se";
const DAY_MS = 24 * 60 * 60 * 1000;

let gateway: FakeCheckoutGateway;
let owner: { id: string };
let mail: ReturnType<typeof createMemoryTransport>;

beforeEach(async () => {
  await resetDatabase(db);
  await db.storeSettings.create({
    data: {
      id: 1,
      storeName: "HeavyCards",
      contactEmail: "kundservice@heavycards.se",
      shippingPriceAmount: 7_900,
      freeShippingThresholdAmount: null,
      vatRateBasisPoints: 2_500,
      lowStockThreshold: 3,
    },
  });
  gateway = new FakeCheckoutGateway();
  mail = createMemoryTransport();
  owner = await createAdmin(db, { role: "OWNER" });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(() => db.$disconnect());

const product = (overrides: Parameters<typeof createProduct>[1] = {}) =>
  createProduct(db, {
    publishedAt: new Date(Date.now() - DAY_MS),
    stockOnHand: 3,
    ...overrides,
  });

async function checkout(productId: string, price: number) {
  const outcome = await createCheckout(
    { db, gateway, siteUrl: SITE },
    {
      attemptId: randomUUID(),
      lines: [{ productId, quantity: 1, expectedUnitPriceAmount: price }],
    },
    { clientKey: clientKey("203.0.113.5", "db-test-auth-secret-0123456789") },
  );
  if (!outcome.ok) throw new Error(JSON.stringify(outcome));
  const order = await db.order.findUniqueOrThrow({
    where: { id: outcome.orderId },
  });
  return { ...outcome, orderNumber: order.orderNumber };
}

function deliver(type: string, object: Record<string, unknown>) {
  const payload = JSON.stringify({
    id: `evt_test_${randomUUID().slice(0, 12)}`,
    object: "event",
    api_version: "2026-09-30.endive",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type,
    data: { object },
  });
  return handleStripeWebhook(
    new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: {
        "stripe-signature": Stripe.webhooks.generateTestHeaderString({
          payload,
          secret: WEBHOOK_SECRET,
        }),
        "content-type": "application/json",
      },
      body: payload,
    }),
    { db, gateway, webhookSecret: WEBHOOK_SECRET },
  );
}

async function available(productId: string) {
  const row = await db.product.findUniqueOrThrow({
    where: { id: productId },
    include: { reservations: true },
  });
  return availableToSell(row.stockOnHand, row.reservations, new Date());
}

/** A checkout Stripe charged with a different amount: flagged, holding stock. */
async function irreconcilable() {
  const box = await product();
  const started = await checkout(box.id, box.priceAmount);
  const charged = box.priceAmount + 7_900 + 100;
  const paid = gateway.completeSession(started.sessionId, {
    amountTotal: charged,
  });
  await deliver("checkout.session.completed", {
    id: started.sessionId,
    object: "checkout.session",
  });
  const order = await db.order.findUniqueOrThrow({
    where: { id: started.orderId },
  });
  expect(order.paymentStatus).toBe("PENDING");
  expect(await available(box.id)).toBe(2);
  return {
    box,
    ...started,
    charged,
    paymentIntentId: paid.paymentIntent!.id,
  };
}

const deps = () => ({ db, gateway });

describe("releasing a hold Stripe and HeavyCards cannot reconcile", () => {
  it("refuses while Stripe keeps any of the customer's money", async () => {
    const { orderNumber, sessionId, charged } = await irreconcilable();

    expect(await assessPaymentHold(deps(), orderNumber)).toMatchObject({
      ok: false,
      error: "NOT_REFUNDED",
      detail: `refunded 0 of ${charged} sek`,
    });
    gateway.addRefund(sessionId, charged - 1);
    expect(
      await releasePaymentHold(deps(), {
        actorId: owner.id,
        orderNumber,
        note: "Delvis återbetald",
      }),
    ).toMatchObject({ ok: false, error: "NOT_REFUNDED" });
    // A pending refund does not count either.
    gateway.addRefund(sessionId, 1, "pending");
    expect(await assessPaymentHold(deps(), orderNumber)).toMatchObject({
      ok: false,
      error: "NOT_REFUNDED",
    });
    expect(await db.auditLog.count({ where: { adminUserId: owner.id } })).toBe(
      0,
    );
  });

  it("releases on Stripe's proof of a full refund, audited with the OWNER, and later refund events change nothing", async () => {
    const { box, orderId, orderNumber, sessionId, charged, paymentIntentId } =
      await irreconcilable();
    gateway.addRefund(sessionId, charged);

    const result = await releasePaymentHold(deps(), {
      actorId: owner.id,
      orderNumber,
      note: "Återbetald i Stripe 2026-10-03",
    });

    expect(result).toMatchObject({
      ok: true,
      orderId,
      evidence: {
        kind: "refunded",
        paymentIntentId,
        chargedAmount: charged,
        refundedAmount: charged,
      },
      productSlugs: [box.slug],
    });
    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { reservations: true },
    });
    expect(order).toMatchObject({
      paymentStatus: "FAILED",
      fulfillmentStatus: "NEW",
      stripePaymentIntentId: paymentIntentId,
      checkoutClientKey: null,
      refundedAmount: 0,
    });
    expect(order.reservations.map((r) => r.status)).toEqual(["RELEASED"]);
    expect(await available(box.id)).toBe(3);
    // Stock on hand is untouched: nothing was sold or restocked.
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: box.id } }))
        .stockOnHand,
    ).toBe(3);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: "OPERATOR_RELEASE_PAYMENT_HOLD" },
    });
    expect(audit).toMatchObject({
      adminUserId: owner.id,
      entityId: orderId,
      metadata: {
        problems: ["amount_mismatch"],
        evidence: "refunded",
        chargedAmount: charged,
        refundedAmount: charged,
        note: "Återbetald i Stripe 2026-10-03",
      },
    });

    const attention = () =>
      db.auditLog.count({ where: { action: "PAYMENT_NEEDS_ATTENTION" } });
    const before = await attention();
    await deliver("charge.refunded", {
      id: "ch_x",
      object: "charge",
      payment_intent: paymentIntentId,
    });
    await deliver("checkout.session.completed", {
      id: sessionId,
      object: "checkout.session",
    });
    expect(
      await db.order.findUniqueOrThrow({ where: { id: orderId } }),
    ).toMatchObject({ paymentStatus: "FAILED", refundedAmount: 0 });
    expect(await attention()).toBe(before + 1); // paid_after_close, for staff
    expect(await available(box.id)).toBe(3);

    // Done once: a second run finds nothing to release.
    expect(
      await releasePaymentHold(deps(), {
        actorId: owner.id,
        orderNumber,
        note: "igen",
      }),
    ).toMatchObject({ ok: false, error: "NOT_HOLDING" });
  });

  it("accepts a canceled payment (no money taken) as proof", async () => {
    const { orderNumber, sessionId, paymentIntentId } = await irreconcilable();
    const session = gateway.session(sessionId)!;
    const canceled: FakeSession = {
      ...session,
      paymentIntent: { id: paymentIntentId, status: "canceled", paidAt: null },
    };
    gateway["save"](canceled);

    expect(
      await releasePaymentHold(deps(), {
        actorId: owner.id,
        orderNumber,
        note: "Avbruten betalning",
      }),
    ).toMatchObject({ ok: true, evidence: { kind: "payment_canceled" } });
  });

  it("only applies to flagged orders that hold stock and Stripe cannot still pay", async () => {
    const box = await product();
    const normal = await checkout(box.id, box.priceAmount);
    expect(await assessPaymentHold(deps(), normal.orderNumber)).toEqual({
      ok: false,
      error: "NOT_FLAGGED",
    });

    // Flagged, but the session is still open (the customer may pay).
    await db.auditLog.create({
      data: {
        action: "PAYMENT_NEEDS_ATTENTION",
        entityType: "Order",
        entityId: normal.orderId,
        metadata: { problem: "unexpected_session_state" },
      },
    });
    expect(await assessPaymentHold(deps(), normal.orderNumber)).toMatchObject({
      ok: false,
      error: "STILL_PAYABLE",
    });

    // Expired at Stripe: the normal recheck releases it, not this procedure.
    gateway.expireAtStripe(normal.sessionId);
    expect(await assessPaymentHold(deps(), normal.orderNumber)).toMatchObject({
      ok: false,
      error: "USE_RECHECK",
    });
    expect(await assessPaymentHold(deps(), 99_999)).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
  });

  it("is refused for an ADMIN and for an inactive OWNER", async () => {
    const { orderNumber, sessionId, charged } = await irreconcilable();
    gateway.addRefund(sessionId, charged);
    const admin = await createAdmin(db, { role: "ADMIN" });
    const inactive = await createAdmin(db, { role: "OWNER", isActive: false });

    for (const actorId of [admin.id, inactive.id]) {
      await expect(
        releasePaymentHold(deps(), { actorId, orderNumber, note: "x" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(await db.order.count({ where: { paymentStatus: "PENDING" } })).toBe(
      1,
    );
  });
});

describe("requeueing a FAILED order email", () => {
  const emailDeps = (): EmailDeps => ({
    db,
    transport: mail,
    siteUrl: SITE,
    reviewLinkKey: deriveReviewLinkKey("db-test-auth-secret-0123456789abcdef"),
  });

  /** A paid order whose confirmation failed with an unknown outcome long ago. */
  async function failedConfirmation() {
    const box = await product();
    const started = await checkout(box.id, box.priceAmount);
    gateway.completeSession(started.sessionId);
    await deliver("checkout.session.completed", {
      id: started.sessionId,
      object: "checkout.session",
    });
    await db.emailDelivery.updateMany({
      where: { orderId: started.orderId },
      data: {
        status: "FAILED",
        attempts: 7,
        lastError: "outcome_unknown",
        outcomeUnknownSince: new Date(Date.now() - 2 * DAY_MS),
      },
    });
    return started;
  }

  it("the old manual procedure (status back to PENDING) failed again at once; the operator command sends once", async () => {
    const { orderId, orderNumber } = await failedConfirmation();

    // What the Milestone 10 runbook said to do by hand:
    await db.emailDelivery.updateMany({
      where: { orderId },
      data: { status: "PENDING", nextAttemptAt: new Date() },
    });
    await processDueEmails(emailDeps(), { orderId });
    expect(
      await db.emailDelivery.findFirstOrThrow({ where: { orderId } }),
    ).toMatchObject({ status: "FAILED", lastError: "outcome_unknown" });
    expect(mail.calls).toHaveLength(0);

    expect(
      await requeueFailedEmail(db, {
        actorId: owner.id,
        orderNumber,
        kind: "ORDER_CONFIRMATION",
      }),
    ).toMatchObject({ ok: true, orderId });
    await processDueEmails(emailDeps(), { orderId });
    await processDueEmails(emailDeps(), { orderId });

    expect(mail.calls).toHaveLength(1);
    expect(mail.messages[0]!.to).toBe("kund@example.com");
    expect(
      await db.emailDelivery.findFirstOrThrow({ where: { orderId } }),
    ).toMatchObject({ status: "SENT", attempts: 1 });
    expect(
      await db.auditLog.findFirstOrThrow({
        where: { action: "OPERATOR_REQUEUE_EMAIL" },
      }),
    ).toMatchObject({
      adminUserId: owner.id,
      entityId: orderId,
      metadata: {
        kind: "ORDER_CONFIRMATION",
        // 7 before, plus the claim of the failed manual attempt above.
        previousAttempts: 8,
        previousError: "outcome_unknown",
      },
    });
  });

  it("refuses deliveries that are not FAILED, already sent, or no longer apply, and non-owners", async () => {
    const { orderId, orderNumber } = await failedConfirmation();
    const requeue = (actorId = owner.id) =>
      requeueFailedEmail(db, {
        actorId,
        orderNumber,
        kind: "ORDER_CONFIRMATION",
      });

    await expect(
      requeue((await createAdmin(db, { role: "ADMIN" })).id),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(
      await requeueFailedEmail(db, {
        actorId: owner.id,
        orderNumber,
        kind: "ORDER_SHIPPED",
      }),
    ).toEqual({ ok: false, error: "NOT_FOUND" });

    // 699 kr + 79 kr shipping, refunded in full.
    await db.order.update({
      where: { id: orderId },
      data: { paymentStatus: "REFUNDED", refundedAmount: 77_800 },
    });
    expect(await requeue()).toEqual({
      ok: false,
      error: "NOT_ELIGIBLE",
      detail: "order_refunded",
    });

    await db.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: "PAID",
        refundedAmount: 0,
        confirmationEmailSentAt: new Date(),
      },
    });
    expect(await requeue()).toEqual({ ok: false, error: "ALREADY_SENT" });

    await db.emailDelivery.updateMany({
      where: { orderId },
      data: { status: "PENDING" },
    });
    expect(await requeue()).toMatchObject({
      ok: false,
      error: "NOT_FAILED",
    });
  });
});

describe("operator authentication", () => {
  it("accepts only an active OWNER with the right password, without saying why not", async () => {
    const password = randomPassword();
    const realOwner = await createAdmin(db, {
      role: "OWNER",
      password,
      email: "agare@heavycards.test",
    });
    const admin = await createAdmin(db, { role: "ADMIN", password });
    const inactive = await createAdmin(db, {
      role: "OWNER",
      isActive: false,
      password,
    });
    const check = (email: string, pw = password) =>
      authenticateOwner(db, { email, password: pw, verifyPassword });

    expect(await check(" AGARE@heavycards.test ")).toBe(realOwner.id);
    expect(await check("agare@heavycards.test", `${password}x`)).toBeNull();
    expect(await check(admin.email)).toBeNull();
    expect(await check(inactive.email)).toBeNull();
    expect(await check("okand@heavycards.test")).toBeNull();
  });
});
