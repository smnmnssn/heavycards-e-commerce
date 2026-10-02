import { randomUUID } from "node:crypto";

import Stripe from "stripe";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError, resolveAdminSession } from "@/lib/auth/authorization";
import { createMemoryTransport } from "@/lib/email/transport";
import type { CheckoutRequest } from "@/lib/checkout/checkout";
import { setAdminActive } from "@/server/admin/admin-users";
import { inviteAdmin } from "@/server/admin/invitations";
import { updateStoreSettings } from "@/server/admin/settings/store-settings";
import { createCheckout } from "@/server/checkout/create-checkout";
import { FakeCheckoutGateway } from "@/server/checkout/fake-gateway";
import {
  deriveReviewLinkKey,
  reviewLinkKeyFromSecrets,
} from "@/server/domain/review-token";
import { processDueEmails } from "@/server/email/outbox";
import { transitionFulfillment } from "@/server/orders/fulfillment";
import { handleStripeWebhook } from "@/server/payments/webhook";
import { findOpenInvitation } from "@/server/reviews/invitations";
import { consumeRateLimit } from "@/server/security/rate-limit";

import {
  cookieHeaderFrom,
  cookieHeaders,
  createAdmin,
  createTestAuth,
  randomPassword,
  signIn,
} from "./auth-helpers";
import {
  createPendingOrder,
  createProduct,
  paidCustomerDetails,
} from "./factories";
import { createTestDb, resetDatabase } from "./test-database";

/*
 * Milestone 14 hardening against real PostgreSQL: the new order invariants,
 * pending orders that staff cannot cancel, adversarial Stripe event
 * sequences, authorization after a role change, rate-limit logging and the
 * dedicated review-link secret.
 */

const db = createTestDb();
const WEBHOOK_SECRET = "whsec_dbtest_signing_secret";
const AUTH_SECRET = "db-test-auth-secret-0123456789abcdef";
const REVIEW_SECRET = "db-test-review-link-secret-0123456789ab";
const SITE = "https://heavycards.se";
const DAY_MS = 24 * 60 * 60 * 1000;

let gateway: FakeCheckoutGateway;
let now: Date;

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
  now = new Date();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(() => db.$disconnect());

const product = (overrides: Parameters<typeof createProduct>[1] = {}) =>
  createProduct(db, {
    publishedAt: new Date(Date.now() - DAY_MS),
    ...overrides,
  });

async function checkout(productId: string, price: number, quantity = 1) {
  const request: CheckoutRequest = {
    attemptId: randomUUID(),
    lines: [{ productId, quantity, expectedUnitPriceAmount: price }],
  };
  const outcome = await createCheckout(
    { db, gateway, siteUrl: SITE, now: () => now },
    request,
  );
  if (!outcome.ok) throw new Error(JSON.stringify(outcome));
  return outcome;
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
    { db, gateway, webhookSecret: WEBHOOK_SECRET, now: () => now },
  );
}

const sessionEvent = (type: string, sessionId: string) =>
  deliver(type, { id: sessionId, object: "checkout.session" });
const refundEvent = (type: string, paymentIntentId: string) =>
  deliver(type, {
    id: `re_${randomUUID().slice(0, 6)}`,
    object: "refund",
    payment_intent: paymentIntentId,
  });

describe("order invariants enforced by the database", () => {
  it("never lets a pending checkout be handled, shipped or cancelled", async () => {
    await expect(
      createPendingOrder(db, { fulfillmentStatus: "CANCELLED" }),
    ).rejects.toThrow("orders_pending_unfulfilled_check");
    await expect(
      createPendingOrder(db, { fulfillmentStatus: "PROCESSING" }),
    ).rejects.toThrow(
      /orders_(fulfillment_requires_payment|pending_unfulfilled)_check/,
    );
  });

  it.each(["EXPIRED", "FAILED"] as const)(
    "never ships a %s (unpaid) order",
    async (paymentStatus) => {
      await expect(
        createPendingOrder(db, {
          paymentStatus,
          fulfillmentStatus: "SHIPPED",
          shippedAt: new Date(),
        }),
      ).rejects.toThrow("orders_fulfillment_requires_payment_check");
      // Closing an unpaid order's fulfillment is harmless and allowed.
      await expect(
        createPendingOrder(db, {
          paymentStatus,
          fulfillmentStatus: "CANCELLED",
        }),
      ).resolves.toBeTruthy();
    },
  );

  it("keeps the refund state consistent with the refunded amount", async () => {
    const reject = (data: Parameters<typeof createPendingOrder>[1]) =>
      expect(
        createPendingOrder(db, { ...paidCustomerDetails, ...data }),
      ).rejects.toThrow("orders_refunded_amount_state_check");
    await reject({ paymentStatus: "PAID", refundedAmount: 100 });
    await reject({ paymentStatus: "PARTIALLY_REFUNDED", refundedAmount: 0 });
    await reject({
      paymentStatus: "PARTIALLY_REFUNDED",
      refundedAmount: 77_800,
    });
    await reject({ paymentStatus: "REFUNDED", refundedAmount: 50_000 });
    await expect(
      createPendingOrder(db, { paymentStatus: "EXPIRED", refundedAmount: 1 }),
    ).rejects.toThrow("orders_refunded_amount_state_check");

    for (const [paymentStatus, refundedAmount] of [
      ["PAID", 0],
      ["PARTIALLY_REFUNDED", 1_000],
      ["REFUNDED", 77_800],
    ] as const) {
      await expect(
        createPendingOrder(db, {
          ...paidCustomerDetails,
          paymentStatus,
          refundedAmount,
        }),
      ).resolves.toBeTruthy();
    }
  });
});

describe("pending orders and staff actions", () => {
  it("refuses cancelling a checkout Stripe may still complete; the payment then finalizes normally", async () => {
    const admin = await createAdmin(db, { role: "ADMIN" });
    const box = await product({ stockOnHand: 2 });
    const { orderId, sessionId } = await checkout(box.id, box.priceAmount);

    const cancel = await transitionFulfillment(db, {
      actorId: admin.id,
      input: { orderId, to: "CANCELLED" },
      reviewLinkKey: deriveReviewLinkKey(AUTH_SECRET),
    });
    expect(cancel).toEqual({
      ok: false,
      error: "PAYMENT_NOT_SETTLED",
      paymentStatus: "PENDING",
    });

    gateway.completeSession(sessionId);
    await sessionEvent("checkout.session.completed", sessionId);
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order).toMatchObject({
      paymentStatus: "PAID",
      fulfillmentStatus: "NEW",
    });
  });
});

describe("adversarial Stripe event sequences", () => {
  it("applies Stripe's state, not the event type: an expiry event for a paid session finalizes", async () => {
    const box = await product({ stockOnHand: 3 });
    const { orderId, sessionId } = await checkout(box.id, box.priceAmount);
    gateway.completeSession(sessionId);

    await sessionEvent("checkout.session.expired", sessionId);
    await sessionEvent("checkout.session.async_payment_failed", sessionId);

    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { reservations: true },
    });
    expect(order.paymentStatus).toBe("PAID");
    expect(order.reservations.map((r) => r.status)).toEqual(["CONSUMED"]);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: box.id } }))
        .stockOnHand,
    ).toBe(2);
  });

  /*
   * Stripe's final truth: paid, then refunded in full. Whatever order (and
   * however often) the events arrive, HeavyCards must end REFUNDED with the
   * stock decremented exactly once, no restock, one confirmation obligation
   * and never an unpaid state after PAID.
   */
  const SEQUENCES: Array<string[]> = [
    ["completed", "refund", "charge", "expired", "completed"],
    ["refund", "completed", "expired", "charge", "refund"],
    ["expired", "charge", "completed", "completed", "refund"],
    ["charge", "expired", "refund", "completed", "async_failed"],
    ["async_failed", "refund", "completed", "charge", "expired"],
  ];

  it.each(SEQUENCES.map((sequence) => [sequence.join(" → "), sequence]))(
    "converges for %s",
    async (_label, sequence) => {
      const box = await product({ stockOnHand: 5, priceAmount: 10_000 });
      const { orderId, sessionId } = await checkout(box.id, 10_000, 2);
      const paid = gateway.completeSession(sessionId);
      const paymentIntentId = paid.paymentIntent!.id;
      gateway.addRefund(sessionId, 2 * 10_000 + 7_900);

      const states: string[] = [];
      for (const step of sequence as string[]) {
        const response =
          step === "completed"
            ? await sessionEvent("checkout.session.completed", sessionId)
            : step === "expired"
              ? await sessionEvent("checkout.session.expired", sessionId)
              : step === "async_failed"
                ? await sessionEvent(
                    "checkout.session.async_payment_failed",
                    sessionId,
                  )
                : step === "refund"
                  ? await refundEvent("refund.created", paymentIntentId)
                  : await deliver("charge.refunded", {
                      id: `ch_${randomUUID().slice(0, 6)}`,
                      object: "charge",
                      payment_intent: paymentIntentId,
                    });
        expect(response.status).toBe(200);
        states.push(
          (await db.order.findUniqueOrThrow({ where: { id: orderId } }))
            .paymentStatus,
        );
      }

      const order = await db.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { reservations: true, emailDeliveries: true },
      });
      expect(order.paymentStatus).toBe("REFUNDED");
      expect(order.refundedAmount).toBe(order.totalAmount);
      expect(order.reservations.map((r) => r.status)).toEqual(["CONSUMED"]);
      expect(
        (await db.product.findUniqueOrThrow({ where: { id: box.id } }))
          .stockOnHand,
      ).toBe(3);
      expect(order.emailDeliveries).toHaveLength(1);
      expect(
        await db.auditLog.count({ where: { action: "MARK_ORDER_PAID" } }),
      ).toBe(1);
      // Once paid, never unpaid again.
      const firstPaid = states.findIndex((s) => s !== "PENDING");
      expect(
        states.slice(firstPaid).every((s) => s === "PAID" || s === "REFUNDED"),
      ).toBe(true);
    },
  );

  it("a refund event for a checkout HeavyCards never accepted changes nothing and restocks nothing", async () => {
    const box = await product({ stockOnHand: 4 });
    const { orderId, sessionId } = await checkout(box.id, box.priceAmount);
    // Stripe charged a different amount: HeavyCards must not accept it.
    const paid = gateway.completeSession(sessionId, { amountTotal: 1 });
    gateway.addRefund(sessionId, 1);

    await sessionEvent("checkout.session.completed", sessionId);
    await refundEvent("refund.created", paid.paymentIntent!.id);

    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { reservations: true },
    });
    expect(order.paymentStatus).toBe("PENDING");
    expect(order.refundedAmount).toBe(0);
    expect(order.reservations.map((r) => r.status)).toEqual(["ACTIVE"]);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: box.id } }))
        .stockOnHand,
    ).toBe(4);
  });
});

describe("authorization after a role or status change", () => {
  it("a session of an OWNER demoted to ADMIN loses OWNER rights at once, in pages and services", async () => {
    const { auth } = createTestAuth(db);
    const password = randomPassword();
    const owner = await createAdmin(db, { role: "OWNER", password });
    const other = await createAdmin(db, { role: "ADMIN" });
    // A second OWNER keeps the store manageable after the demotion.
    await createAdmin(db, { role: "OWNER" });
    const cookie = cookieHeaderFrom(await signIn(auth, owner.email, password));

    await db.adminUser.update({
      where: { id: owner.id },
      data: { role: "ADMIN" },
    });

    expect(
      await resolveAdminSession(auth, cookieHeaders(cookie)),
    ).toMatchObject({ id: owner.id, role: "ADMIN" });
    await expect(
      updateStoreSettings(db, {
        actorId: owner.id,
        input: {
          storeName: "Hijacked",
          contactEmail: "a@b.se",
          companyName: "",
          organizationNumber: "",
          shippingPrice: "0",
          freeShippingThreshold: "",
          defaultShippingCarrier: "POSTNORD",
          vatRate: "2500",
          lowStockThreshold: "3",
          defaultSeoTitle: "",
          defaultSeoDescription: "",
        },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      setAdminActive(db, {
        actorId: owner.id,
        targetId: other.id,
        active: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      inviteAdmin(db, createMemoryTransport(), {
        actorId: owner.id,
        input: { name: "Ny", email: "ny@heavycards.test" },
        siteUrl: SITE,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(
      (await db.adminUser.findUniqueOrThrow({ where: { id: other.id } }))
        .isActive,
    ).toBe(true);
    expect(
      (await db.storeSettings.findUniqueOrThrow({ where: { id: 1 } }))
        .storeName,
    ).toBe("HeavyCards");
  });

  it("a deactivated administrator's live session stops working on the next request", async () => {
    const { auth } = createTestAuth(db);
    const password = randomPassword();
    const admin = await createAdmin(db, { role: "ADMIN", password });
    const cookie = cookieHeaderFrom(await signIn(auth, admin.email, password));
    expect(
      await resolveAdminSession(auth, cookieHeaders(cookie)),
    ).not.toBeNull();

    await db.adminUser.update({
      where: { id: admin.id },
      data: { isActive: false },
    });
    expect(await resolveAdminSession(auth, cookieHeaders(cookie))).toBeNull();
  });
});

describe("rate-limit logging", () => {
  it("logs the first refusal per client and window once, without the client key", async () => {
    const info = vi.mocked(console.info);
    info.mockClear();
    const rule = { scope: "test-log", limit: 2, windowMs: 60_000 };
    const key = "test-log:0123456789abcdef0123456789abcdef01234567";

    const results = [];
    for (let i = 0; i < 6; i += 1) {
      results.push((await consumeRateLimit(db, rule, key, now)).allowed);
    }

    expect(results).toEqual([true, true, false, false, false, false]);
    const logged = info.mock.calls.filter(([message]) =>
      String(message).includes("rate limit reached"),
    );
    expect(logged).toEqual([
      [
        "[security] rate limit reached",
        { scope: "test-log", limit: 2, windowSeconds: 60 },
      ],
    ]);
    expect(JSON.stringify(info.mock.calls)).not.toContain("0123456789abcdef");
  });
});

describe("dedicated review-link secret (Milestone 14)", () => {
  it("a shipping email still waiting when REVIEW_LINK_SECRET is introduced keeps its working link", async () => {
    const admin = await createAdmin(db, { role: "ADMIN" });
    const box = await product({ stockOnHand: 3 });
    const { orderId, sessionId } = await checkout(box.id, box.priceAmount);
    gateway.completeSession(sessionId);
    await sessionEvent("checkout.session.completed", sessionId);

    // Shipped while review links were still derived from AUTH_SECRET.
    const legacyKey = deriveReviewLinkKey(AUTH_SECRET);
    for (const to of ["PROCESSING", "SHIPPED"]) {
      await transitionFulfillment(db, {
        actorId: admin.id,
        input: { orderId, to, shippingCarrier: "POSTNORD", trackingNumber: "" },
        reviewLinkKey: legacyKey,
      });
    }

    // The email goes out after the deployment with the dedicated secret.
    const mail = createMemoryTransport();
    await processDueEmails(
      {
        db,
        transport: mail,
        siteUrl: SITE,
        reviewLinkKey: reviewLinkKeyFromSecrets({
          reviewLinkSecret: REVIEW_SECRET,
          previousReviewLinkSecret: null,
          authSecret: AUTH_SECRET,
        }),
      },
      { orderId },
    );
    const shipping = mail.messages.find((m) => m.subject.includes("skickats"));
    const token = shipping?.text.match(
      /https:\/\/heavycards\.se\/review\/([\w-]{43})/,
    )?.[1];
    expect(token).toBeDefined();
    expect(await findOpenInvitation(db, token, new Date())).not.toBeNull();
  });
});

describe("housekeeping of expired security data (Milestone 14)", () => {
  it("deletes stale IP-keyed rate limits, expired sessions and spent reset values, keeping live ones", async () => {
    const { pruneExpiredSecurityData } =
      await import("@/server/security/housekeeping");
    const admin = await createAdmin(db, { role: "ADMIN" });
    const hour = 60 * 60 * 1000;
    await db.authRateLimit.createMany({
      data: [
        {
          key: "203.0.113.9|/sign-in/email",
          count: 3,
          lastRequest: BigInt(now.getTime() - 25 * hour),
        },
        {
          key: "203.0.113.10|/sign-in/email",
          count: 1,
          lastRequest: BigInt(now.getTime() - 60_000),
        },
      ],
    });
    await db.adminSession.createMany({
      data: [
        {
          userId: admin.id,
          token: "expired-token",
          expiresAt: new Date(now.getTime() - hour),
          ipAddress: "203.0.113.9",
        },
        {
          userId: admin.id,
          token: "live-token",
          expiresAt: new Date(now.getTime() + hour),
        },
      ],
    });
    await db.authVerification.create({
      data: {
        identifier: "reset-password:hash",
        value: admin.id,
        expiresAt: new Date(now.getTime() - hour),
      },
    });

    expect(await pruneExpiredSecurityData(db, now)).toMatchObject({
      authRateLimits: 1,
      adminSessions: 1,
      authVerifications: 1,
    });
    expect((await db.authRateLimit.findMany()).map((row) => row.key)).toEqual([
      "203.0.113.10|/sign-in/email",
    ]);
    expect((await db.adminSession.findMany()).map((s) => s.token)).toEqual([
      "live-token",
    ]);
    expect(await db.authVerification.count()).toBe(0);
  });
});
