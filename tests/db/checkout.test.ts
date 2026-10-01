import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { CheckoutRequest } from "@/lib/checkout/checkout";
import { loadCartProducts } from "@/server/cart/cart-products";
import { releaseExpiredReservations } from "@/server/checkout/cleanup";
import {
  createCheckout,
  type CheckoutDeps,
} from "@/server/checkout/create-checkout";
import { FakeCheckoutGateway } from "@/server/checkout/fake-gateway";
import type { CheckoutGateway } from "@/server/checkout/gateway";
import {
  CHECKOUT_SESSION_TTL_MS,
  PROVISIONAL_HOLD_MS,
  RESERVATION_GRACE_MS,
  sessionExpiryFor,
} from "@/server/domain/checkout";
import { availableToSell } from "@/server/domain/inventory";

import { createCategory, createPendingOrder, createProduct } from "./factories";
import { createTestDb, resetDatabase } from "./test-database";

const db = createTestDb();
const SITE = "http://localhost:3100";
const DAY_MS = 24 * 60 * 60 * 1000;

let gateway: FakeCheckoutGateway;
let now: Date;
let deps: CheckoutDeps;

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
  deps = { db, gateway, siteUrl: SITE, now: () => now };
});
afterAll(() => db.$disconnect());

const published = () => ({ publishedAt: new Date(Date.now() - DAY_MS) });

async function product(overrides: Parameters<typeof createProduct>[1] = {}) {
  return createProduct(db, { ...published(), ...overrides });
}

function request(
  lines: Array<{ id: string; quantity?: number; price: number }>,
  extra: Partial<CheckoutRequest> = {},
): CheckoutRequest {
  return {
    attemptId: randomUUID(),
    lines: lines.map(({ id, quantity = 1, price }) => ({
      productId: id,
      quantity,
      expectedUnitPriceAmount: price,
    })),
    ...extra,
  };
}

async function available(productId: string, at = now) {
  const row = await db.product.findUniqueOrThrow({
    where: { id: productId },
    include: { reservations: true },
  });
  return availableToSell(row.stockOnHand, row.reservations, at);
}

describe("pending order creation", () => {
  it("creates a PENDING order with snapshots, totals and reservations", async () => {
    const box = await product({
      name: "Destined Rivals Booster Box",
      sku: "SV10-BB-EN",
      priceAmount: 219_900,
      stockOnHand: 4,
    });
    const pack = await product({ priceAmount: 6_900, stockOnHand: 50 });

    const outcome = await createCheckout(
      deps,
      request([
        { id: box.id, quantity: 2, price: 219_900 },
        { id: pack.id, quantity: 3, price: 6_900 },
      ]),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.url).toMatch(/^https:\/\/checkout\.stripe\.com\/c\/pay\//);

    const order = await db.order.findUniqueOrThrow({
      where: { id: outcome.orderId },
      include: { items: true, reservations: true },
    });
    // 2 × 2 199 + 3 × 69 = 4 605 kr: above the 1 500 kr threshold.
    expect(order).toMatchObject({
      paymentStatus: "PENDING",
      fulfillmentStatus: "NEW",
      currency: "SEK",
      country: "SE",
      subtotalAmount: 460_500,
      shippingAmount: 0,
      totalAmount: 460_500,
      taxAmount: 92_100, // 25 % VAT contained in the total
      stripeCheckoutSessionId: outcome.sessionId,
      stripePaymentIntentId: null,
      shippingCarrier: "POSTNORD",
      paidAt: null,
      email: null,
      customerName: null,
      addressLine1: null,
      confirmationEmailSentAt: null,
    });
    expect(order.orderNumber).toBe(10_001);
    expect(order.checkoutExpiresAt).toEqual(sessionExpiryFor(now));
    expect(
      now.getTime() +
        CHECKOUT_SESSION_TTL_MS -
        order.checkoutExpiresAt!.getTime(),
    ).toBeLessThan(1000);

    const boxItem = order.items.find((item) => item.productId === box.id);
    expect(boxItem).toMatchObject({
      productNameSnapshot: "Destined Rivals Booster Box",
      skuSnapshot: "SV10-BB-EN",
      quantity: 2,
      unitPriceAmount: 219_900,
      totalPriceAmount: 439_800,
      vatRateBasisPoints: 2_500,
    });

    // Reservations hold until Stripe stops accepting payment, plus grace.
    const sessionExpiry = gateway.sessions.get(outcome.sessionId)!.expiresAt;
    expect(order.reservations).toHaveLength(2);
    for (const reservation of order.reservations) {
      expect(reservation.status).toBe("ACTIVE");
      expect(reservation.expiresAt.getTime()).toBe(
        sessionExpiry.getTime() + RESERVATION_GRACE_MS,
      );
    }

    // Physical stock is untouched; only availability drops.
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: box.id } }))
        .stockOnHand,
    ).toBe(4);
    expect(await available(box.id)).toBe(2);
  });

  it("charges flat shipping below the free-shipping threshold and none at it", async () => {
    const cheap = await product({ priceAmount: 149_999 });
    const exact = await product({ priceAmount: 150_000 });

    const below = await createCheckout(
      deps,
      request([{ id: cheap.id, price: 149_999 }]),
    );
    const at = await createCheckout(
      deps,
      request([{ id: exact.id, price: 150_000 }]),
    );

    const orders = await db.order.findMany({ orderBy: { orderNumber: "asc" } });
    expect(below.ok && at.ok).toBe(true);
    expect(orders[0]).toMatchObject({
      subtotalAmount: 149_999,
      shippingAmount: 7_900,
      totalAmount: 157_899,
      taxAmount: 31_580,
    });
    expect(orders[1]).toMatchObject({
      subtotalAmount: 150_000,
      shippingAmount: 0,
      totalAmount: 150_000,
    });
  });

  it("always charges shipping when free shipping is disabled", async () => {
    await db.storeSettings.update({
      where: { id: 1 },
      data: { freeShippingThresholdAmount: null, shippingPriceAmount: 4_900 },
    });
    const box = await product({ priceAmount: 999_900 });

    await createCheckout(deps, request([{ id: box.id, price: 999_900 }]));

    expect(await db.order.findFirstOrThrow()).toMatchObject({
      shippingAmount: 4_900,
      totalAmount: 1_004_800,
    });
  });

  it("sends the authoritative order to Stripe for Sweden only", async () => {
    const box = await product({ name: "Box", priceAmount: 10_000 });

    const outcome = await createCheckout(
      deps,
      request([{ id: box.id, quantity: 3, price: 10_000 }]),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { input } = gateway.sessions.get(outcome.sessionId)!;
    expect(input).toMatchObject({
      orderId: outcome.orderId,
      orderNumber: "HC-10001",
      lines: [{ name: "Box", quantity: 3, unitPriceAmount: 10_000 }],
      shippingAmount: 7_900,
      shippingLabel: "PostNord",
      totalAmount: 37_900,
      successUrl: `${SITE}/kassa/bekraftelse?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${SITE}/kassa/avbruten`,
    });
  });

  it("fails safely without store settings", async () => {
    await db.storeSettings.deleteMany();
    const box = await product();

    const outcome = await createCheckout(
      deps,
      request([{ id: box.id, price: box.priceAmount }]),
    );

    expect(outcome).toEqual({ ok: false, code: "payment_unavailable" });
    expect(await db.order.count()).toBe(0);
  });
});

describe("authoritative validation", () => {
  it("never charges a browser-supplied price: a stale price is rejected", async () => {
    const box = await product({ priceAmount: 219_900 });

    const outcome = await createCheckout(
      deps,
      request([{ id: box.id, price: 100 }]),
    );

    expect(outcome).toEqual({
      ok: false,
      code: "rejected",
      issues: [
        {
          productId: box.id,
          kind: "price_changed",
          unitPriceAmount: 219_900,
          expectedUnitPriceAmount: 100,
        },
      ],
      conflict: null,
    });
    expect(await db.order.count()).toBe(0);
    expect(await db.inventoryReservation.count()).toBe(0);
    expect(gateway.createCalls).toBe(0);
  });

  it("rejects unknown, draft, archived and not-yet-orderable products", async () => {
    const draft = await createProduct(db, { status: "DRAFT" });
    const archived = await product({ status: "ARCHIVED" });
    const comingSoon = await product({ status: "COMING_SOON" });
    const unpublished = await createProduct(db, { publishedAt: null });
    const unknown = randomUUID();

    const outcome = await createCheckout(
      deps,
      request([
        { id: draft.id, price: draft.priceAmount },
        { id: archived.id, price: archived.priceAmount },
        { id: comingSoon.id, price: comingSoon.priceAmount },
        { id: unpublished.id, price: unpublished.priceAmount },
        { id: unknown, price: 100 },
      ]),
    );

    expect(outcome).toMatchObject({ ok: false, code: "rejected" });
    if (outcome.ok || outcome.code !== "rejected") return;
    expect(
      Object.fromEntries(
        outcome.issues.map((issue) => [
          issue.productId,
          issue.kind === "unavailable" ? issue.reason : issue.kind,
        ]),
      ),
    ).toEqual({
      [draft.id]: "not_found",
      [archived.id]: "discontinued",
      [comingSoon.id]: "coming_soon",
      [unpublished.id]: "not_found",
      [unknown]: "not_found",
    });
    expect(await db.order.count()).toBe(0);
  });

  it("rejects sold-out products and quantities above available-to-sell", async () => {
    const soldOut = await product({ stockOnHand: 0 });
    const few = await product({ stockOnHand: 3 });

    const outcome = await createCheckout(
      deps,
      request([
        { id: soldOut.id, price: soldOut.priceAmount },
        { id: few.id, quantity: 4, price: few.priceAmount },
      ]),
    );

    expect(outcome).toMatchObject({
      ok: false,
      code: "rejected",
      issues: [
        { productId: soldOut.id, kind: "unavailable", reason: "sold_out" },
        {
          productId: few.id,
          kind: "insufficient_quantity",
          availableQuantity: 3,
        },
      ],
    });
  });

  it("counts active reservations but not expired or released ones", async () => {
    const box = await product({ stockOnHand: 3 });
    const other = await createPendingOrder(db);
    const another = await createPendingOrder(db);
    const third = await createPendingOrder(db);
    await db.inventoryReservation.createMany({
      data: [
        // Holds one unit.
        {
          orderId: other.id,
          productId: box.id,
          quantity: 1,
          expiresAt: new Date(now.getTime() + 60_000),
        },
        // Expired but never cleaned up: holds nothing.
        {
          orderId: another.id,
          productId: box.id,
          quantity: 1,
          expiresAt: new Date(now.getTime() - 1),
        },
        // Released: holds nothing.
        {
          orderId: third.id,
          productId: box.id,
          quantity: 1,
          status: "RELEASED",
          expiresAt: new Date(now.getTime() + 60_000),
        },
      ],
    });

    const tooMany = await createCheckout(
      deps,
      request([{ id: box.id, quantity: 3, price: box.priceAmount }]),
    );
    const fits = await createCheckout(
      deps,
      request([{ id: box.id, quantity: 2, price: box.priceAmount }]),
    );

    expect(tooMany).toMatchObject({
      ok: false,
      issues: [{ kind: "insufficient_quantity", availableQuantity: 2 }],
    });
    expect(fits.ok).toBe(true);
    expect(await available(box.id)).toBe(0);
  });
});

describe("preorder rules (enforced on the server)", () => {
  const releaseIn = (days: number) =>
    new Date(
      `${new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10)}T00:00:00Z`,
    );

  it("never mixes preorders with in-stock products", async () => {
    const stock = await product();
    const preorder = await product({
      status: "COMING_SOON",
      isPreorder: true,
      releaseDate: releaseIn(30),
    });

    const outcome = await createCheckout(
      deps,
      request([
        { id: stock.id, price: stock.priceAmount },
        { id: preorder.id, price: preorder.priceAmount },
      ]),
    );

    expect(outcome).toEqual({
      ok: false,
      code: "rejected",
      issues: [],
      conflict: "preorder_with_stock",
    });
    expect(await db.order.count()).toBe(0);
  });

  it("treats isPreorder as authoritative after the release date has passed", async () => {
    const stock = await product();
    const released = await product({
      isPreorder: true,
      releaseDate: releaseIn(-10),
    });

    const outcome = await createCheckout(
      deps,
      request([
        { id: stock.id, price: stock.priceAmount },
        { id: released.id, price: released.priceAmount },
      ]),
    );

    expect(outcome).toMatchObject({ conflict: "preorder_with_stock" });
  });

  it("combines preorders only with one identical, known release date", async () => {
    const date = releaseIn(30);
    const a = await product({ isPreorder: true, releaseDate: date });
    const b = await product({ isPreorder: true, releaseDate: date });
    const later = await product({
      isPreorder: true,
      releaseDate: releaseIn(60),
    });
    const undated = await product({ isPreorder: true, releaseDate: null });
    const undated2 = await product({ isPreorder: true, releaseDate: null });

    const same = await createCheckout(
      deps,
      request([
        { id: a.id, price: a.priceAmount },
        { id: b.id, price: b.priceAmount },
      ]),
    );
    const different = await createCheckout(
      deps,
      request([
        { id: a.id, price: a.priceAmount },
        { id: later.id, price: later.priceAmount },
      ]),
    );
    const unknownDates = await createCheckout(
      deps,
      request([
        { id: undated.id, price: undated.priceAmount },
        { id: undated2.id, price: undated2.priceAmount },
      ]),
    );
    const single = await createCheckout(
      deps,
      request([{ id: undated.id, price: undated.priceAmount }]),
    );

    expect(same.ok).toBe(true);
    expect(different).toMatchObject({ conflict: "different_release_dates" });
    expect(unknownDates).toMatchObject({
      conflict: "different_release_dates",
    });
    expect(single.ok).toBe(true);
  });
});

describe("reservation lifecycle and Stripe failures", () => {
  it("holds stock only briefly until the Stripe session is attached", async () => {
    const box = await product({ stockOnHand: 1 });
    let during: { expiresAt: Date; sessionId: string | null } | undefined;
    gateway.beforeCreate = async () => {
      const reservation = await db.inventoryReservation.findFirstOrThrow({
        include: { order: true },
      });
      during = {
        expiresAt: reservation.expiresAt,
        sessionId: reservation.order.stripeCheckoutSessionId,
      };
    };

    const outcome = await createCheckout(
      deps,
      request([{ id: box.id, price: box.priceAmount }]),
    );

    expect(outcome.ok).toBe(true);
    // While Stripe is called, only a short hold exists, so a crash at this
    // point frees the unit within PROVISIONAL_HOLD_MS.
    expect(during).toEqual({
      expiresAt: new Date(now.getTime() + PROVISIONAL_HOLD_MS),
      sessionId: null,
    });
    // A crash before attaching frees the unit after the provisional hold.
    // Once attached, the hold outlasts the provisional window.
    expect(
      await available(box.id, new Date(now.getTime() + PROVISIONAL_HOLD_MS)),
    ).toBe(0);
  });

  it("releases the reservation when Stripe session creation fails", async () => {
    const box = await product({ stockOnHand: 1 });
    gateway.failNextCreate = new Error("Stripe is down");
    const attempt = request([{ id: box.id, price: box.priceAmount }]);

    const outcome = await createCheckout(deps, attempt);

    expect(outcome).toEqual({ ok: false, code: "payment_unavailable" });
    const order = await db.order.findFirstOrThrow({
      include: { reservations: true },
    });
    expect(order.paymentStatus).toBe("EXPIRED");
    expect(order.stripeCheckoutSessionId).toBeNull();
    expect(order.reservations.map((r) => r.status)).toEqual(["RELEASED"]);
    expect(await available(box.id)).toBe(1);

    // The failed attempt is closed; a new attempt succeeds.
    expect(await createCheckout(deps, attempt)).toEqual({
      ok: false,
      code: "attempt_closed",
    });
    expect(
      (
        await createCheckout(
          deps,
          request([{ id: box.id, price: box.priceAmount }]),
        )
      ).ok,
    ).toBe(true);
  });

  it("refuses a session whose amount does not match the order", async () => {
    const box = await product({ stockOnHand: 1, priceAmount: 10_000 });
    const wrong: CheckoutGateway = {
      createCheckoutSession: async (input, options) => ({
        ...(await gateway.createCheckoutSession(input, options)),
        amountTotal: 1,
      }),
      expireCheckoutSession: (id) => gateway.expireCheckoutSession(id),
    };

    const outcome = await createCheckout(
      { ...deps, gateway: wrong },
      request([{ id: box.id, price: 10_000 }]),
    );

    expect(outcome).toEqual({ ok: false, code: "payment_unavailable" });
    expect([...gateway.sessions.values()][0]!.status).toBe("expired");
    expect(await available(box.id)).toBe(1);
  });

  it("an abandoned reservation stops holding stock once it expires, and cleanup tidies it", async () => {
    const box = await product({ stockOnHand: 1 });
    await createCheckout(
      deps,
      request([{ id: box.id, price: box.priceAmount }]),
    );
    const reservation = await db.inventoryReservation.findFirstOrThrow();
    const afterExpiry = new Date(reservation.expiresAt.getTime() + 1);

    expect(await available(box.id)).toBe(0);
    expect(await available(box.id, afterExpiry)).toBe(1);

    // A later customer can buy it even before any cleanup ran.
    const later = await createCheckout(
      { ...deps, now: () => afterExpiry },
      request([{ id: box.id, price: box.priceAmount }]),
    );
    expect(later.ok).toBe(true);

    expect(await releaseExpiredReservations(db, afterExpiry)).toBe(1);
    const statuses = await db.inventoryReservation.findMany({
      orderBy: { createdAt: "asc" },
      select: { status: true },
    });
    expect(statuses.map((s) => s.status)).toEqual(["RELEASED", "ACTIVE"]);
  });
});

describe("idempotent checkout creation", () => {
  it("returns the same order and session when an attempt is repeated", async () => {
    const box = await product({ stockOnHand: 5 });
    const attempt = request([
      { id: box.id, quantity: 2, price: box.priceAmount },
    ]);

    const first = await createCheckout(deps, attempt);
    const second = await createCheckout(deps, attempt);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second).toMatchObject({
      orderId: first.orderId,
      sessionId: first.sessionId,
      url: first.url,
      reused: true,
    });
    expect(await db.order.count()).toBe(1);
    expect(await db.inventoryReservation.count()).toBe(1);
    expect(gateway.sessions.size).toBe(1);
    expect(await available(box.id)).toBe(3);
  });

  it("handles a simultaneous double submission of one attempt", async () => {
    const box = await product({ stockOnHand: 1 });
    const attempt = request([{ id: box.id, price: box.priceAmount }]);

    const results = await Promise.all([
      createCheckout(deps, attempt),
      createCheckout(deps, attempt),
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(new Set(results.map((r) => r.ok && r.orderId)).size).toBe(1);
    expect(await db.order.count()).toBe(1);
    expect(gateway.sessions.size).toBe(1);
  });

  it("closes an attempt whose cart or displayed prices changed", async () => {
    const box = await product({ stockOnHand: 5 });
    const attempt = request([
      { id: box.id, quantity: 1, price: box.priceAmount },
    ]);
    await createCheckout(deps, attempt);

    const changed = await createCheckout(deps, {
      ...attempt,
      lines: [{ ...attempt.lines[0]!, quantity: 2 }],
    });

    expect(changed).toEqual({ ok: false, code: "attempt_closed" });
    expect(await db.order.count()).toBe(1);
  });

  it("does not reuse a session that is about to expire", async () => {
    const box = await product({ stockOnHand: 5 });
    const attempt = request([{ id: box.id, price: box.priceAmount }]);
    await createCheckout(deps, attempt);

    const late = new Date(now.getTime() + CHECKOUT_SESSION_TTL_MS - 60_000);
    expect(await createCheckout({ ...deps, now: () => late }, attempt)).toEqual(
      { ok: false, code: "attempt_closed" },
    );
  });

  it("a new attempt releases the previous one, so a customer never blocks their own stock", async () => {
    const lastUnit = await product({ stockOnHand: 1 });
    const extra = await product();
    const first = request([{ id: lastUnit.id, price: lastUnit.priceAmount }]);
    const firstOutcome = await createCheckout(deps, first);
    expect(firstOutcome.ok).toBe(true);
    if (!firstOutcome.ok) return;

    // Back from Stripe, the customer adds another product and retries.
    const second = await createCheckout(
      deps,
      request(
        [
          { id: lastUnit.id, price: lastUnit.priceAmount },
          { id: extra.id, price: extra.priceAmount },
        ],
        { previousAttemptId: first.attemptId },
      ),
    );

    expect(second.ok).toBe(true);
    expect(gateway.sessions.get(firstOutcome.sessionId)!.status).toBe(
      "expired",
    );
    const previous = await db.order.findUniqueOrThrow({
      where: { id: firstOutcome.orderId },
      include: { reservations: true },
    });
    expect(previous.paymentStatus).toBe("EXPIRED");
    expect(previous.reservations.map((r) => r.status)).toEqual(["RELEASED"]);
    expect(await available(lastUnit.id)).toBe(0); // held by the new attempt
  });

  it("the cart does not count the customer's own pending attempt as sold out", async () => {
    const lastUnit = await product({ stockOnHand: 1 });
    const mine = request([{ id: lastUnit.id, price: lastUnit.priceAmount }]);
    await createCheckout(deps, mine);

    const [forMe] = await loadCartProducts(db, [lastUnit.id], now, {
      ownAttemptId: mine.attemptId,
    });
    const [forOthers] = await loadCartProducts(db, [lastUnit.id], now);
    const [forStranger] = await loadCartProducts(db, [lastUnit.id], now, {
      ownAttemptId: randomUUID(),
    });

    expect(forMe).toMatchObject({ available: true, maxQuantity: 1 });
    expect(forOthers).toMatchObject({
      available: false,
      unavailableReason: "sold_out",
    });
    expect(forStranger).toMatchObject({ available: false });
  });

  it("leaves a previous attempt alone if its session was completed", async () => {
    const box = await product({ stockOnHand: 5 });
    const first = request([{ id: box.id, price: box.priceAmount }]);
    const outcome = await createCheckout(deps, first);
    if (!outcome.ok) throw new Error("expected success");
    gateway.sessions.get(outcome.sessionId)!.status = "complete";

    await createCheckout(
      deps,
      request([{ id: box.id, price: box.priceAmount }], {
        previousAttemptId: first.attemptId,
      }),
    );

    const previous = await db.order.findUniqueOrThrow({
      where: { id: outcome.orderId },
      include: { reservations: true },
    });
    expect(previous.paymentStatus).toBe("PENDING");
    expect(previous.reservations[0]!.status).toBe("ACTIVE");
  });

  it("never hands out a session for an order released while Stripe was called", async () => {
    const box = await product({ stockOnHand: 1 });
    const first = request([{ id: box.id, price: box.priceAmount }]);
    gateway.beforeCreate = async () => {
      gateway.beforeCreate = null;
      // A newer attempt from the same browser supersedes this one mid-flight.
      const superseding = await createCheckout(
        deps,
        request([{ id: box.id, price: box.priceAmount }], {
          previousAttemptId: first.attemptId,
        }),
      );
      expect(superseding.ok).toBe(true);
    };

    const outcome = await createCheckout(deps, first);

    expect(outcome).toEqual({ ok: false, code: "attempt_closed" });
    const statuses = [...gateway.sessions.values()].map((s) => s.status);
    expect(statuses.sort()).toEqual(["expired", "open"]);
    expect(await available(box.id)).toBe(0);
    expect(
      await db.inventoryReservation.count({ where: { status: "ACTIVE" } }),
    ).toBe(1);
  });
});

describe("concurrency: no overselling", () => {
  it("lets exactly one of many simultaneous checkouts reserve the last unit", async () => {
    const box = await product({ stockOnHand: 1 });

    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        createCheckout(deps, request([{ id: box.id, price: box.priceAmount }])),
      ),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    for (const result of results.filter((r) => !r.ok)) {
      expect(result).toMatchObject({
        code: "rejected",
        issues: [{ kind: "unavailable", reason: "sold_out" }],
      });
    }
    expect(
      await db.inventoryReservation.aggregate({
        _sum: { quantity: true },
        where: { status: "ACTIVE" },
      }),
    ).toEqual({ _sum: { quantity: 1 } });
    expect(await db.order.count()).toBe(1);
  });

  it("never reserves more than stock across many concurrent multi-unit checkouts", async () => {
    const box = await product({ stockOnHand: 7 });

    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        createCheckout(
          deps,
          request([
            { id: box.id, quantity: (i % 3) + 1, price: box.priceAmount },
          ]),
        ),
      ),
    );

    const reserved = await db.inventoryReservation.aggregate({
      _sum: { quantity: true },
      where: { status: "ACTIVE" },
    });
    expect(reserved._sum.quantity).toBeLessThanOrEqual(7);
    expect(results.some((r) => r.ok)).toBe(true);
    expect(results.some((r) => !r.ok)).toBe(true);
    expect(await available(box.id)).toBe(7 - reserved._sum.quantity!);
  });

  it("locks products in a fixed order, so opposite cart orders do not deadlock", async () => {
    const category = await createCategory(db);
    const a = await product({ categoryId: category.id, stockOnHand: 3 });
    const b = await product({ categoryId: category.id, stockOnHand: 3 });

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        createCheckout(
          deps,
          request(
            i % 2 === 0
              ? [
                  { id: a.id, price: a.priceAmount },
                  { id: b.id, price: b.priceAmount },
                ]
              : [
                  { id: b.id, price: b.priceAmount },
                  { id: a.id, price: a.priceAmount },
                ],
          ),
        ),
      ),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(await available(a.id)).toBe(0);
    expect(await available(b.id)).toBe(0);
  });
});
