import { randomUUID } from "node:crypto";

import Stripe from "stripe";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { CheckoutRequest } from "@/lib/checkout/checkout";
import {
  createCheckout,
  type CheckoutDeps,
} from "@/server/checkout/create-checkout";
import { FakeCheckoutGateway } from "@/server/checkout/fake-gateway";
import { handleCheckoutRequest } from "@/server/checkout/handle-request";
import {
  MAX_HELD_UNITS_PER_CLIENT,
  MAX_OPEN_CHECKOUTS_PER_CLIENT,
} from "@/server/domain/checkout";
import { availableToSell } from "@/server/domain/inventory";
import { handleStripeWebhook } from "@/server/payments/webhook";
import { clientKey } from "@/server/security/rate-limit";

import { createProduct } from "./factories";
import { createTestDb, resetDatabase } from "./test-database";

/*
 * Milestone 14: deliberate inventory holding. A checkout reserves stock for
 * the Stripe session's lifetime (40 minutes plus grace), so the caps on open
 * holds per client are what keep one client from making products look sold
 * out without paying. These tests also re-prove that the caps never weaken
 * the Milestone 8/9 rules: holds still end only on Stripe's outcome.
 */

const db = createTestDb();
const SECRET = "db-test-auth-secret-0123456789abcdef";
const WEBHOOK_SECRET = "whsec_dbtest_signing_secret";
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
      freeShippingThresholdAmount: null,
      vatRateBasisPoints: 2_500,
      lowStockThreshold: 3,
    },
  });
  gateway = new FakeCheckoutGateway();
  now = new Date();
  deps = { db, gateway, siteUrl: SITE, now: () => now };
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(() => db.$disconnect());

const product = (overrides: Parameters<typeof createProduct>[1] = {}) =>
  createProduct(db, {
    publishedAt: new Date(Date.now() - DAY_MS),
    stockOnHand: 100,
    ...overrides,
  });

function request(
  lines: Array<{ id: string; price: number; quantity?: number }>,
  extra: Partial<CheckoutRequest> = {},
): CheckoutRequest {
  return {
    attemptId: randomUUID(),
    lines: lines.map(({ id, price, quantity = 1 }) => ({
      productId: id,
      quantity,
      expectedUnitPriceAmount: price,
    })),
    ...extra,
  };
}

const ALICE = clientKey("203.0.113.10", SECRET);
const BOB = clientKey("203.0.113.20", SECRET);

const start = (
  key: string | null,
  lines: Parameters<typeof request>[0],
  extra?: Partial<CheckoutRequest>,
) => createCheckout(deps, request(lines, extra), { clientKey: key });

async function available(productId: string) {
  const row = await db.product.findUniqueOrThrow({
    where: { id: productId },
    include: { reservations: true },
  });
  return availableToSell(row.stockOnHand, row.reservations, now);
}

function signedEvent(type: string, sessionId: string) {
  const payload = JSON.stringify({
    id: `evt_test_${randomUUID().slice(0, 12)}`,
    object: "event",
    api_version: "2026-09-30.endive",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type,
    data: { object: { id: sessionId, object: "checkout.session" } },
  });
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: {
      "stripe-signature": Stripe.webhooks.generateTestHeaderString({
        payload,
        secret: WEBHOOK_SECRET,
      }),
      "content-type": "application/json",
    },
    body: payload,
  });
}

const deliver = (type: string, sessionId: string) =>
  handleStripeWebhook(signedEvent(type, sessionId), {
    db,
    gateway,
    webhookSecret: WEBHOOK_SECRET,
    now: () => now,
  });

describe("open checkouts per client", () => {
  it(`allows ${MAX_OPEN_CHECKOUTS_PER_CLIENT} open checkouts, refuses the next, and leaves other clients alone`, async () => {
    const box = await product();
    for (let i = 0; i < MAX_OPEN_CHECKOUTS_PER_CLIENT; i += 1) {
      expect(
        (await start(ALICE, [{ id: box.id, price: box.priceAmount }])).ok,
      ).toBe(true);
    }

    const refused = await start(ALICE, [
      { id: box.id, price: box.priceAmount },
    ]);
    expect(refused).toEqual({
      ok: false,
      code: "hold_limit",
      limit: "checkouts",
      maxUnits: MAX_HELD_UNITS_PER_CLIENT,
    });
    // Nothing was reserved or created for the refused request.
    expect(await db.order.count()).toBe(MAX_OPEN_CHECKOUTS_PER_CLIENT);
    expect(await available(box.id)).toBe(100 - MAX_OPEN_CHECKOUTS_PER_CLIENT);

    expect(
      (await start(BOB, [{ id: box.id, price: box.priceAmount }])).ok,
    ).toBe(true);
  });

  it(`caps the units one client holds at ${MAX_HELD_UNITS_PER_CLIENT}, in one checkout or across several`, async () => {
    const box = await product();
    const pack = await product({ priceAmount: 6_900 });

    expect(
      await start(ALICE, [
        { id: box.id, price: box.priceAmount, quantity: 20 },
        { id: pack.id, price: 6_900, quantity: MAX_HELD_UNITS_PER_CLIENT - 19 },
      ]),
    ).toMatchObject({ ok: false, code: "hold_limit", limit: "units" });

    expect(
      (
        await start(ALICE, [
          { id: box.id, price: box.priceAmount, quantity: 20 },
        ])
      ).ok,
    ).toBe(true);
    expect(
      await start(ALICE, [{ id: pack.id, price: 6_900, quantity: 11 }]),
    ).toMatchObject({ ok: false, code: "hold_limit", limit: "units" });
    expect(
      (await start(ALICE, [{ id: pack.id, price: 6_900, quantity: 10 }])).ok,
    ).toBe(true);
    expect(await available(box.id)).toBe(80);
  });

  it("never caps a repeated submission of an existing attempt (double click, return from Stripe)", async () => {
    const box = await product();
    const attemptId = randomUUID();
    const first = await start(
      ALICE,
      [{ id: box.id, price: box.priceAmount, quantity: 10 }],
      { attemptId },
    );
    for (let i = 1; i < MAX_OPEN_CHECKOUTS_PER_CLIENT; i += 1) {
      await start(ALICE, [{ id: box.id, price: box.priceAmount }]);
    }

    const again = await start(
      ALICE,
      [{ id: box.id, price: box.priceAmount, quantity: 10 }],
      { attemptId },
    );
    expect(again).toMatchObject({ ok: true, reused: true });
    if (first.ok && again.ok) expect(again.sessionId).toBe(first.sessionId);
  });

  it("a customer changing the cart supersedes the old checkout, which frees its allowance", async () => {
    const box = await product();
    let previous: string | undefined;
    // Far more cart changes than the cap: each new attempt names the last.
    for (let i = 1; i <= MAX_OPEN_CHECKOUTS_PER_CLIENT + 3; i += 1) {
      const attemptId = randomUUID();
      const outcome = await start(
        ALICE,
        [{ id: box.id, price: box.priceAmount, quantity: i }],
        { attemptId, previousAttemptId: previous },
      );
      expect(outcome.ok).toBe(true);
      previous = attemptId;
    }
    expect(await db.order.count({ where: { paymentStatus: "PENDING" } })).toBe(
      1,
    );
  });

  it("frees the allowance when Stripe reports a hold expired or paid, and clears the client key", async () => {
    const box = await product();
    const sessions: string[] = [];
    for (let i = 0; i < MAX_OPEN_CHECKOUTS_PER_CLIENT; i += 1) {
      const outcome = await start(ALICE, [
        { id: box.id, price: box.priceAmount },
      ]);
      if (!outcome.ok) throw new Error("checkout failed");
      sessions.push(outcome.sessionId);
    }
    expect(
      (await start(ALICE, [{ id: box.id, price: box.priceAmount }])).ok,
    ).toBe(false);

    gateway.expireAtStripe(sessions[0]!);
    expect(
      (await deliver("checkout.session.expired", sessions[0]!)).status,
    ).toBe(200);
    gateway.completeSession(sessions[1]!);
    expect(
      (await deliver("checkout.session.completed", sessions[1]!)).status,
    ).toBe(200);

    const closed = await db.order.findMany({
      where: { stripeCheckoutSessionId: { in: sessions.slice(0, 2) } },
      select: { paymentStatus: true, checkoutClientKey: true },
    });
    expect(closed.map((order) => order.paymentStatus).sort()).toEqual([
      "EXPIRED",
      "PAID",
    ]);
    expect(closed.every((order) => order.checkoutClientKey === null)).toBe(
      true,
    );

    for (let i = 0; i < 2; i += 1) {
      expect(
        (await start(ALICE, [{ id: box.id, price: box.priceAmount }])).ok,
      ).toBe(true);
    }
  });

  it("does not count provisional holds that lapsed (crashed checkouts)", async () => {
    const box = await product();
    gateway.failNextCreate = new Error("Stripe down");
    expect(
      await start(ALICE, [
        { id: box.id, price: box.priceAmount, quantity: 25 },
      ]),
    ).toMatchObject({ ok: false, code: "payment_unavailable" });
    // The failed checkout released its own hold at once.
    expect(
      (
        await start(ALICE, [
          { id: box.id, price: box.priceAmount, quantity: 25 },
        ])
      ).ok,
    ).toBe(true);
  });

  it("a double submission of one new attempt at the cap's edge reuses the order instead of refusing", async () => {
    const box = await product();
    for (let i = 1; i < MAX_OPEN_CHECKOUTS_PER_CLIENT; i += 1) {
      await start(ALICE, [{ id: box.id, price: box.priceAmount }]);
    }
    const attemptId = randomUUID();
    const twice = await Promise.all(
      [0, 1].map(() =>
        start(ALICE, [{ id: box.id, price: box.priceAmount }], { attemptId }),
      ),
    );

    expect(twice.map((outcome) => outcome.ok)).toEqual([true, true]);
    if (twice[0]!.ok && twice[1]!.ok) {
      expect(twice[0]!.orderId).toBe(twice[1]!.orderId);
    }
    expect(await db.order.count()).toBe(MAX_OPEN_CHECKOUTS_PER_CLIENT);
  });

  it("holds the cap under simultaneous requests from one client", async () => {
    const box = await product();
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () =>
        start(ALICE, [{ id: box.id, price: box.priceAmount }]),
      ),
    );

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(
      MAX_OPEN_CHECKOUTS_PER_CLIENT,
    );
    expect(
      outcomes.filter((o) => !o.ok && o.code === "hold_limit"),
    ).toHaveLength(8 - MAX_OPEN_CHECKOUTS_PER_CLIENT);
    expect(await available(box.id)).toBe(100 - MAX_OPEN_CHECKOUTS_PER_CLIENT);
  });

  it("keeps the last unit protected: a capped client never frees someone else's hold", async () => {
    const last = await product({ stockOnHand: 1 });
    const bobs = await start(BOB, [{ id: last.id, price: last.priceAmount }]);
    expect(bobs.ok).toBe(true);
    expect(
      await start(ALICE, [{ id: last.id, price: last.priceAmount }]),
    ).toMatchObject({ ok: false, code: "rejected" });
    expect(await available(last.id)).toBe(0);
  });
});

describe("POST /api/checkout with the open-hold cap", () => {
  const post = (body: unknown, ip: string) =>
    new Request(`${SITE}/api/checkout`, {
      method: "POST",
      headers: {
        origin: SITE,
        "content-type": "application/json",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify(body),
    });
  const handlerDeps = () => ({
    db,
    gateway,
    siteUrl: SITE,
    secret: SECRET,
    now: () => now,
  });

  it("answers 429 hold_limit with Retry-After per client IP, and logs no address", async () => {
    const box = await product();
    const errors = vi.spyOn(console, "error");
    const infos = vi.spyOn(console, "info");
    const body = () => request([{ id: box.id, price: box.priceAmount }]);

    for (let i = 0; i < MAX_OPEN_CHECKOUTS_PER_CLIENT; i += 1) {
      expect(
        (
          await handleCheckoutRequest(
            post(body(), "198.51.100.7"),
            handlerDeps(),
          )
        ).status,
      ).toBe(200);
    }
    const refused = await handleCheckoutRequest(
      post(body(), "198.51.100.7"),
      handlerDeps(),
    );
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await refused.json()).toEqual({
      ok: false,
      code: "hold_limit",
      limit: "checkouts",
      maxUnits: MAX_HELD_UNITS_PER_CLIENT,
    });

    // The same network address on another request is the same client; a
    // different address is not.
    expect(
      (await handleCheckoutRequest(post(body(), "198.51.100.8"), handlerDeps()))
        .status,
    ).toBe(200);

    const logged = JSON.stringify([...errors.mock.calls, ...infos.mock.calls]);
    expect(logged).toContain("open-hold limit reached");
    expect(logged).not.toContain("198.51.100.7");
    expect(logged).not.toContain(clientKey("198.51.100.7", SECRET));
  });
});
