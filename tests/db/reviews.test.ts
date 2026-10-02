import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Prisma } from "@/generated/prisma/client";
import { ForbiddenError } from "@/lib/auth/authorization";
import {
  createMemoryTransport,
  EmailDeliveryError,
} from "@/lib/email/transport";
import { generateSecureToken, hashToken } from "@/lib/security/tokens";
import { DEFAULT_REVIEW_DISPLAY_NAME } from "@/lib/validation/reviews";
import { getProductBySlug } from "@/server/data/catalog-queries";
import { RETRY_DELAYS_MS } from "@/server/domain/email-delivery";
import {
  deriveReviewLinkKey,
  rawReviewToken,
  REVIEW_TOKEN_TTL_DAYS,
} from "@/server/domain/review-token";
import {
  processDueEmails,
  runEmailJobs,
  type EmailDeps,
} from "@/server/email/outbox";
import { transitionFulfillment } from "@/server/orders/fulfillment";
import { findOpenInvitation } from "@/server/reviews/invitations";
import {
  moderateReview,
  REVIEW_AUDIT_ACTIONS,
} from "@/server/reviews/moderation";
import { submitReview } from "@/server/reviews/submit";

import { createAdmin } from "./auth-helpers";
import { createProduct, paidCustomerDetails } from "./factories";
import { createTestDb, resetDatabase } from "./test-database";

/*
 * Milestone 11: verified-purchase reviews against real PostgreSQL. Orders
 * are shipped through the real fulfillment service, the shipping email is
 * rendered by the real outbox (memory transport), and the review link is
 * taken from that email, exactly as a customer would receive it.
 */

const db = createTestDb();
const SITE = "https://heavycards.se";
const AUTH_SECRET = "db-test-auth-secret-0123456789abcdef";
const REVIEW_KEY = deriveReviewLinkKey(AUTH_SECRET);
const DAY_MS = 24 * 60 * 60 * 1000;
const LINK = /https:\/\/heavycards\.se\/review\/([\w-]{43})(?=\s|"|$)/;

let mail: ReturnType<typeof createMemoryTransport>;
let now: Date;
let admin: { id: string };

beforeEach(async () => {
  await resetDatabase(db);
  await db.storeSettings.create({
    data: {
      id: 1,
      storeName: "HeavyCards",
      contactEmail: "kundservice@heavycards.se",
      shippingPriceAmount: 7_900,
      vatRateBasisPoints: 2_500,
      lowStockThreshold: 3,
    },
  });
  mail = createMemoryTransport();
  now = new Date();
  admin = await createAdmin(db, { role: "ADMIN" });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(() => db.$disconnect());

// --- Helpers ---------------------------------------------------------------------

const emailDeps = (overrides: Partial<EmailDeps> = {}): EmailDeps => ({
  db,
  transport: mail,
  siteUrl: SITE,
  reviewLinkKey: REVIEW_KEY,
  now: () => now,
  ...overrides,
});

const later = (ms: number) => {
  now = new Date(now.getTime() + ms);
};

const product = (overrides: Parameters<typeof createProduct>[1] = {}) =>
  createProduct(db, {
    publishedAt: new Date(Date.now() - DAY_MS),
    ...overrides,
  });

type Product = Awaited<ReturnType<typeof product>>;

/** A paid order with one line per product (as checkout creates them). */
async function paidOrder(
  lines: Array<{ product: Product; quantity?: number }>,
  overrides: Partial<Prisma.OrderUncheckedCreateInput> = {},
) {
  const items = lines.map(({ product, quantity = 1 }) => ({
    productId: product.id,
    productNameSnapshot: product.name,
    skuSnapshot: product.sku,
    quantity,
    unitPriceAmount: product.priceAmount,
    totalPriceAmount: product.priceAmount * quantity,
    vatRateBasisPoints: 2_500,
  }));
  const subtotal = items.reduce((sum, item) => sum + item.totalPriceAmount, 0);
  return db.order.create({
    data: {
      ...paidCustomerDetails,
      subtotalAmount: subtotal,
      shippingAmount: 0,
      taxAmount: 0,
      totalAmount: subtotal,
      ...overrides,
      items: { create: items },
    },
    include: { items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
}

const transition = (orderId: string, to: string, extra: object = {}) =>
  transitionFulfillment(db, {
    actorId: admin.id,
    input: { orderId, to, ...extra },
    reviewLinkKey: REVIEW_KEY,
    now,
  });

async function ship(orderId: string) {
  expect(await transition(orderId, "PROCESSING")).toMatchObject({ ok: true });
  const shipped = await transition(orderId, "SHIPPED");
  expect(shipped).toMatchObject({ ok: true, changed: true });
  return shipped;
}

/** Ships the order and returns the review token from its shipping email. */
async function shipAndOpenEmail(orderId: string): Promise<string> {
  await ship(orderId);
  await processDueEmails(emailDeps(), { orderId });
  return tokenFromEmail(orderId);
}

function tokenFromEmail(orderId: string): string {
  const call = mail.calls.findLast(
    (c) => c.idempotencyKey === `order-shipped/${orderId}`,
  );
  const token = call?.message.text.match(LINK)?.[1];
  if (!token) throw new Error("no review link in the shipping email");
  return token;
}

const invitations = (orderId?: string) =>
  db.reviewToken.findMany({ where: orderId ? { orderId } : {} });

const reviewInput = (
  orderItemId: string,
  overrides: Record<string, unknown> = {},
) => ({
  orderItemId,
  rating: "4",
  title: "",
  body: "Välpackad och precis som beskrivet.",
  displayName: "",
  ...overrides,
});

const submit = (
  rawToken: unknown,
  orderItemId: string,
  overrides: Record<string, unknown> = {},
) =>
  submitReview(db, {
    rawToken,
    input: reviewInput(orderItemId, overrides),
    now,
  });

async function shippedOrderWithLink(
  lines: Array<{ product: Product; quantity?: number }>,
) {
  const order = await paidOrder(lines);
  const token = await shipAndOpenEmail(order.id);
  return { order, token };
}

// --- Invitation created with the first SHIPPED transition ------------------------

describe("review invitation at SHIPPED", () => {
  it("is created once, in the shipping transaction, as nonce + hash only", async () => {
    const order = await paidOrder([{ product: await product() }]);
    await transition(order.id, "PROCESSING");
    expect(await invitations()).toHaveLength(0);

    await transition(order.id, "SHIPPED");

    const [invitation] = await invitations(order.id);
    expect(invitation).toMatchObject({
      orderId: order.id,
      createdAt: now,
      expiresAt: new Date(now.getTime() + REVIEW_TOKEN_TTL_DAYS * DAY_MS),
      revokedAt: null,
    });
    expect(invitation!.nonce).toMatch(/^[\w-]{43}$/);
    expect(invitation!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // The email obligation was created in the same transaction.
    expect(
      await db.emailDelivery.count({
        where: { orderId: order.id, kind: "ORDER_SHIPPED" },
      }),
    ).toBe(1);
  });

  it("never mints another invitation: repeated, concurrent and later transitions", async () => {
    const order = await paidOrder([{ product: await product() }]);
    await transition(order.id, "PROCESSING");

    const results = await Promise.all(
      Array.from({ length: 6 }, () => transition(order.id, "SHIPPED")),
    );
    expect(results.filter((r) => r.ok && r.changed)).toHaveLength(1);
    const [first] = await invitations(order.id);

    expect(
      await transition(order.id, "SHIPPED", { trackingNumber: "RR1SE" }),
    ).toMatchObject({ ok: true, changed: true }); // tracking correction only
    await transition(order.id, "COMPLETED");

    expect(await invitations()).toEqual([first]);
  });

  it("is never created for orders that cannot be shipped", async () => {
    const item = await product();
    for (const paymentStatus of ["PENDING", "FAILED", "EXPIRED"] as const) {
      const order = await db.order.create({
        data: {
          paymentStatus,
          subtotalAmount: 0,
          shippingAmount: 0,
          taxAmount: 0,
          totalAmount: 0,
        },
      });
      expect(await transition(order.id, "PROCESSING")).toMatchObject({
        ok: false,
        error: "PAYMENT_NOT_SETTLED",
      });
    }
    const paid = await paidOrder([{ product: item }]);
    expect(await transition(paid.id, "SHIPPED")).toMatchObject({
      ok: false,
      error: "INVALID_TRANSITION",
    });
    await transition(paid.id, "CANCELLED");
    const refunded = await paidOrder([{ product: item }], {
      paymentStatus: "REFUNDED",
      refundedAmount: item.priceAmount,
    });
    expect(await transition(refunded.id, "PROCESSING")).toMatchObject({
      ok: false,
      error: "PAYMENT_NOT_SETTLED",
    });

    expect(await invitations()).toHaveLength(0);
  });
});

// --- The link in the shipping email -----------------------------------------------

describe("review link in the shipping email", () => {
  it("is part of the one shipping email and opens this order's invitation", async () => {
    const item = await product({ name: "Elite Trainer Box" });
    const order = await paidOrder([{ product: item }]);
    const token = await shipAndOpenEmail(order.id);

    expect(mail.calls).toHaveLength(1);
    const { message } = mail.calls[0]!;
    expect(message.text).toContain(
      "När du har fått din beställning får du gärna berätta vad du tycker.",
    );
    expect(message.html).toContain(`${SITE}/review/${token}`);
    const [invitation] = await invitations(order.id);
    expect(hashToken(token)).toBe(invitation!.tokenHash);
    expect(rawReviewToken(REVIEW_KEY, invitation!)).toBe(token);
  });

  it("is identical on every retry and never mints a new token", async () => {
    const order = await paidOrder([{ product: await product() }]);
    await ship(order.id);
    mail.queue(
      { fail: new EmailDeliveryError("timeout", "unknown") },
      { fail: new EmailDeliveryError("rate_limit_exceeded", "not_sent") },
    );

    await processDueEmails(emailDeps(), { orderId: order.id });
    later(RETRY_DELAYS_MS[0]!);
    await processDueEmails(emailDeps(), { orderId: order.id });
    later(RETRY_DELAYS_MS[1]!);
    await processDueEmails(emailDeps(), { orderId: order.id });

    expect(mail.calls).toHaveLength(3);
    const [first, ...retries] = mail.calls;
    for (const retry of retries) {
      // Same key and same payload: what Resend's idempotency requires.
      expect(retry.idempotencyKey).toBe(first!.idempotencyKey);
      expect(retry.message).toEqual(first!.message);
    }
    expect(mail.messages).toHaveLength(1);
    expect(await invitations()).toHaveLength(1);
    expect(hashToken(first!.message.text.match(LINK)![1]!)).toBe(
      (await invitations())[0]!.tokenHash,
    );
  });

  it("is left out, not broken, if AUTH_SECRET changed before the email went out", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const order = await paidOrder([{ product: await product() }]);
    await ship(order.id);

    await processDueEmails(
      emailDeps({
        reviewLinkKey: deriveReviewLinkKey("rotated-secret-0123456789abcdefgh"),
      }),
    );

    expect(mail.messages).toHaveLength(1);
    expect(mail.messages[0]!.text).not.toMatch(/recens/i);
    expect(JSON.stringify(error.mock.calls)).toContain(
      "review_link_key_mismatch",
    );
  });
});

describe("orders shipped before Milestone 11", () => {
  async function legacyShippedOrder(shippingEmailSentAt: Date | null) {
    const order = await paidOrder([{ product: await product() }], {
      fulfillmentStatus: "SHIPPED",
      shippedAt: new Date(now.getTime() - 10 * DAY_MS),
      shippingCarrier: "POSTNORD",
      confirmationEmailSentAt: new Date(now.getTime() - 12 * DAY_MS),
      shippingEmailSentAt,
    });
    return order;
  }

  it("get no invitation and no email from the scheduled run", async () => {
    await legacyShippedOrder(new Date(now.getTime() - 10 * DAY_MS));
    await paidOrder([{ product: await product() }], {
      fulfillmentStatus: "COMPLETED",
      shippedAt: new Date(now.getTime() - 30 * DAY_MS),
      confirmationEmailSentAt: new Date(now.getTime() - 31 * DAY_MS),
      shippingEmailSentAt: new Date(now.getTime() - 30 * DAY_MS),
    });

    const summary = await runEmailJobs(emailDeps());

    expect(summary).toMatchObject({ enqueued: 0, attempted: 0 });
    expect(mail.calls).toHaveLength(0);
    expect(await invitations()).toHaveLength(0);
    expect(await db.emailDelivery.count()).toBe(0);
  });

  it("a shipping email still owed from before keeps its original content (no link)", async () => {
    const order = await legacyShippedOrder(null);
    await db.emailDelivery.create({
      data: { orderId: order.id, kind: "ORDER_SHIPPED", nextAttemptAt: now },
    });

    await processDueEmails(emailDeps());

    expect(mail.messages).toHaveLength(1);
    expect(mail.messages[0]!.text).not.toMatch(/recens/i);
    expect(await invitations()).toHaveLength(0);
  });
});

// --- Opening the review page --------------------------------------------------------

describe("review page lookup", () => {
  it("shows exactly the purchased lines of this order, with what was bought", async () => {
    const [box, pack] = [
      await product({ name: "Booster Box" }),
      await product({ name: "Booster Pack" }),
    ];
    const { order, token } = await shippedOrderWithLink([
      { product: box },
      { product: pack, quantity: 3 },
    ]);
    // Another customer's order with another product.
    const other = await shippedOrderWithLink([
      { product: await product({ name: "Annan kunds produkt" }) },
    ]);

    const invitation = await findOpenInvitation(db, token, now);

    expect(invitation?.lines).toEqual([
      {
        orderItemId: order.items[0]!.id,
        name: "Booster Box",
        quantity: 1,
        image: null,
        reviewed: false,
      },
      {
        orderItemId: order.items[1]!.id,
        name: "Booster Pack",
        quantity: 3,
        image: null,
        reviewed: false,
      },
    ]);
    expect(JSON.stringify(invitation)).not.toContain(other.order.items[0]!.id);
  });

  it("keeps working after the product is renamed, re-slugged, repriced and archived", async () => {
    const item = await product({ name: "Original namn" });
    const { order, token } = await shippedOrderWithLink([{ product: item }]);
    await db.product.update({
      where: { id: item.id },
      data: {
        name: "Nytt namn",
        slug: "nytt-namn",
        priceAmount: 99_900,
        status: "ARCHIVED",
      },
    });

    const invitation = await findOpenInvitation(db, token, now);
    expect(invitation?.lines[0]).toMatchObject({ name: "Original namn" });
    expect(await submit(token, order.items[0]!.id)).toEqual({
      ok: true,
      remainingLines: 0,
    });
    expect(
      await db.review.findFirstOrThrow({ select: { productId: true } }),
    ).toEqual({ productId: item.id });
  });

  it("gives one generic answer for every unusable link", async () => {
    const { order, token } = await shippedOrderWithLink([
      { product: await product() },
    ]);
    const [stored] = await invitations(order.id);

    for (const candidate of [
      undefined,
      "",
      "not-a-token",
      generateSecureToken(), // well-formed, unknown
      stored!.tokenHash, // the database hash is not a credential
      stored!.nonce, // nor is the nonce
      order.id,
      String(order.orderNumber),
      paidCustomerDetails.email,
    ]) {
      expect(await findOpenInvitation(db, candidate, now)).toBeNull();
    }

    expect(await findOpenInvitation(db, token, stored!.expiresAt)).toBeNull();
    expect(
      await findOpenInvitation(
        db,
        token,
        new Date(stored!.expiresAt.getTime() - 1),
      ),
    ).not.toBeNull();

    await db.reviewToken.update({
      where: { id: stored!.id },
      data: { revokedAt: now },
    });
    expect(await findOpenInvitation(db, token, now)).toBeNull();
  });

  it("is closed once every line has been reviewed", async () => {
    const [a, b] = [await product(), await product()];
    const { order, token } = await shippedOrderWithLink([
      { product: a },
      { product: b },
    ]);

    expect(await submit(token, order.items[0]!.id)).toEqual({
      ok: true,
      remainingLines: 1,
    });
    const halfway = await findOpenInvitation(db, token, now);
    expect(halfway?.lines.map((line) => line.reviewed)).toEqual([true, false]);

    expect(await submit(token, order.items[1]!.id)).toEqual({
      ok: true,
      remainingLines: 0,
    });
    expect(await findOpenInvitation(db, token, now)).toBeNull();
    expect(await submit(token, order.items[1]!.id)).toEqual({
      ok: false,
      error: "ALREADY_REVIEWED",
    });
  });

  it("refuses an invitation of an order that is not shipped and paid (defence in depth)", async () => {
    const order = await paidOrder([{ product: await product() }]);
    await transition(order.id, "PROCESSING");
    const rawToken = generateSecureToken();
    await db.reviewToken.create({
      data: {
        orderId: order.id,
        nonce: generateSecureToken(),
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(now.getTime() + DAY_MS),
      },
    });

    expect(await findOpenInvitation(db, rawToken, now)).toBeNull();
    expect(await submit(rawToken, order.items[0]!.id)).toEqual({
      ok: false,
      error: "INVALID_LINK",
    });
    expect(await db.review.count()).toBe(0);
  });
});

// --- Submitting -------------------------------------------------------------------------

describe("submitting a review", () => {
  it("creates one PENDING, verified review for the purchased product", async () => {
    const item = await product();
    const { order, token } = await shippedOrderWithLink([{ product: item }]);

    const result = await submit(token, order.items[0]!.id, {
      rating: "5",
      title: "  Toppen  ",
      body: "  Kom snabbt.\r\n\r\n\r\nVäl inslagen.  ",
      displayName: " Kim ",
    });

    expect(result).toEqual({ ok: true, remainingLines: 0 });
    const review = await db.review.findFirstOrThrow();
    expect(review).toMatchObject({
      productId: item.id,
      orderItemId: order.items[0]!.id,
      rating: 5,
      title: "Toppen",
      body: "Kom snabbt.\n\nVäl inslagen.",
      displayName: "Kim",
      verifiedPurchase: true,
      status: "PENDING",
    });
  });

  it("never publishes the customer's identity; a blank name is generic", async () => {
    const { order, token } = await shippedOrderWithLink([
      { product: await product() },
    ]);

    await submit(token, order.items[0]!.id);

    const review = await db.review.findFirstOrThrow();
    expect(review.displayName).toBe(DEFAULT_REVIEW_DISPLAY_NAME);
    const stored = JSON.stringify(review);
    for (const value of [
      paidCustomerDetails.customerName,
      "Kim", // first part of the customer's name: never derived
      paidCustomerDetails.email,
      paidCustomerDetails.addressLine1,
    ]) {
      expect(stored).not.toContain(value);
    }
  });

  it.each([
    ["rating below 1", { rating: "0" }, "rating"],
    ["rating above 5", { rating: "6" }, "rating"],
    ["a fractional rating", { rating: "4.5" }, "rating"],
    ["no rating", { rating: null }, "rating"],
    ["too short text", { body: "Bra" }, "body"],
    ["oversized text", { body: "x".repeat(2001) }, "body"],
    ["a huge payload", { body: "x".repeat(50_000) }, "body"],
    ["a non-string body", { body: { html: "<b>x</b>" } }, "body"],
    ["an email as name", { displayName: "kim@example.com" }, "displayName"],
  ])("refuses %s and creates nothing", async (_label, overrides, field) => {
    const { order, token } = await shippedOrderWithLink([
      { product: await product() },
    ]);

    const result = await submit(token, order.items[0]!.id, overrides);

    expect(result).toMatchObject({ ok: false, error: "INVALID_INPUT" });
    expect(
      result.ok === false && "fieldErrors" in result && result.fieldErrors,
    ).toHaveProperty(field);
    expect(await db.review.count()).toBe(0);
    expect(await findOpenInvitation(db, token, now)).not.toBeNull();
  });

  it("cannot review another order's line or substitute a product", async () => {
    const mine = await product({ name: "Mitt köp" });
    const theirs = await product({ name: "Inte mitt köp" });
    const { order, token } = await shippedOrderWithLink([{ product: mine }]);
    const other = await shippedOrderWithLink([{ product: theirs }]);

    expect(await submit(token, other.order.items[0]!.id)).toEqual({
      ok: false,
      error: "INVALID_LINK",
    });
    expect(await submit(token, "0199a8c0-0000-7000-8000-00000000ffff")).toEqual(
      { ok: false, error: "INVALID_LINK" },
    );

    // Extra fields (a product, a status, a verified flag) are ignored.
    const result = await submitReview(db, {
      rawToken: token,
      input: {
        ...reviewInput(order.items[0]!.id),
        productId: theirs.id,
        status: "APPROVED",
        verifiedPurchase: false,
      },
      now,
    });
    expect(result).toEqual({ ok: true, remainingLines: 0 });
    const reviews = await db.review.findMany();
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      productId: mine.id,
      status: "PENDING",
      verifiedPurchase: true,
    });
    // The other customer can still review their own purchase.
    expect(await submit(other.token, other.order.items[0]!.id)).toEqual({
      ok: true,
      remainingLines: 0,
    });
  });

  it("refuses expired and revoked links at submission time", async () => {
    const { order, token } = await shippedOrderWithLink([
      { product: await product() },
    ]);
    const [stored] = await invitations(order.id);

    expect(
      await submitReview(db, {
        rawToken: token,
        input: reviewInput(order.items[0]!.id),
        now: stored!.expiresAt,
      }),
    ).toEqual({ ok: false, error: "INVALID_LINK" });

    await db.reviewToken.update({
      where: { id: stored!.id },
      data: { revokedAt: now },
    });
    expect(await submit(token, order.items[0]!.id)).toEqual({
      ok: false,
      error: "INVALID_LINK",
    });
    expect(await db.review.count()).toBe(0);
  });

  it("a double click or retry creates one review", async () => {
    const { order, token } = await shippedOrderWithLink([
      { product: await product() },
    ]);

    expect(await submit(token, order.items[0]!.id)).toMatchObject({ ok: true });
    expect(await submit(token, order.items[0]!.id, { rating: "1" })).toEqual({
      ok: false,
      error: "ALREADY_REVIEWED",
    });

    expect(await db.review.findMany({ select: { rating: true } })).toEqual([
      { rating: 4 },
    ]);
  });

  it("concurrent submissions for one line create exactly one review", async () => {
    const { order, token } = await shippedOrderWithLink([
      { product: await product() },
    ]);

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        submit(token, order.items[0]!.id, { rating: String((i % 5) + 1) }),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      results.filter((r) => !r.ok && r.error === "ALREADY_REVIEWED"),
    ).toHaveLength(9);
    expect(await db.review.count()).toBe(1);
  });

  it("a line bought three times still allows exactly one review", async () => {
    const { order, token } = await shippedOrderWithLink([
      { product: await product(), quantity: 3 },
    ]);
    expect(order.items).toHaveLength(1);

    expect(await submit(token, order.items[0]!.id)).toEqual({
      ok: true,
      remainingLines: 0,
    });
    expect(await submit(token, order.items[0]!.id)).toEqual({
      ok: false,
      error: "ALREADY_REVIEWED",
    });
    expect(await db.review.count()).toBe(1);
  });

  it("each purchased product can be reviewed separately", async () => {
    const products = [await product(), await product(), await product()];
    const { order, token } = await shippedOrderWithLink(
      products.map((p) => ({ product: p })),
    );

    for (const [index, item] of order.items.entries()) {
      expect(await submit(token, item.id)).toEqual({
        ok: true,
        remainingLines: 2 - index,
      });
    }
    const reviews = await db.review.findMany({ orderBy: { productId: "asc" } });
    expect(reviews.map((r) => r.productId).sort()).toEqual(
      products.map((p) => p.id).sort(),
    );
  });

  it("a refund after shipping neither removes a review nor issues a new link", async () => {
    const item = await product();
    const { order, token } = await shippedOrderWithLink([{ product: item }]);
    await submit(token, order.items[0]!.id);

    await db.order.update({
      where: { id: order.id },
      data: { paymentStatus: "REFUNDED", refundedAmount: item.priceAmount },
    });
    await runEmailJobs(emailDeps());

    expect(await db.review.count()).toBe(1);
    expect(await invitations()).toHaveLength(1);
    expect(mail.calls).toHaveLength(1); // only the original shipping email
  });
});

// --- Public ratings and moderation --------------------------------------------------------

describe("public ratings", () => {
  async function reviewedProduct(ratings: number[]) {
    const item = await product({ slug: `betyg-${ratings.join("")}` });
    const orders = [];
    for (const rating of ratings) {
      const { order, token } = await shippedOrderWithLink([{ product: item }]);
      expect(
        await submit(token, order.items[0]!.id, { rating: String(rating) }),
      ).toMatchObject({ ok: true });
      orders.push(order);
    }
    const reviews = await db.review.findMany({
      where: { productId: item.id },
      orderBy: { createdAt: "asc" },
    });
    return { item, reviews };
  }

  const publicView = (slug: string) => getProductBySlug(db, slug, new Date());

  it("a product without reviews renders an empty summary", async () => {
    const item = await product({ slug: "utan-recensioner" });
    expect(await publicView(item.slug)).toMatchObject({
      reviews: [],
      reviewSummary: { count: 0, averageRating: null },
    });
  });

  it("pending and rejected reviews never count; approved ones do, with the right average", async () => {
    const { item, reviews } = await reviewedProduct([5, 2, 1]);
    expect(await publicView(item.slug)).toMatchObject({
      reviews: [],
      reviewSummary: { count: 0, averageRating: null },
    });

    await moderateReview(db, {
      actorId: admin.id,
      input: { reviewId: reviews[0]!.id, decision: "APPROVE" },
    });
    await moderateReview(db, {
      actorId: admin.id,
      input: { reviewId: reviews[1]!.id, decision: "APPROVE" },
    });
    await moderateReview(db, {
      actorId: admin.id,
      input: { reviewId: reviews[2]!.id, decision: "REJECT" },
    });

    const view = await publicView(item.slug);
    expect(view?.reviewSummary).toEqual({ count: 2, averageRating: 3.5 });
    expect(view?.reviews.map((r) => r.rating).sort()).toEqual([2, 5]);
    expect(view?.reviews.every((r) => r.verifiedPurchase)).toBe(true);
    expect(JSON.stringify(view)).not.toContain(paidCustomerDetails.email);
  });
});

describe("moderation", () => {
  async function pendingReview() {
    const item = await product({ slug: `moderering-${Date.now()}` });
    const { order, token } = await shippedOrderWithLink([{ product: item }]);
    await submit(token, order.items[0]!.id);
    const review = await db.review.findFirstOrThrow({
      where: { productId: item.id },
    });
    return { item, review };
  }

  const moderate = (reviewId: string, decision: string, actorId = admin.id) =>
    moderateReview(db, { actorId, input: { reviewId, decision } });

  const auditFor = (reviewId: string) =>
    db.auditLog.findMany({
      where: { entityType: "Review", entityId: reviewId },
      orderBy: { createdAt: "asc" },
    });

  it("approves a pending review, audits it and names the page to refresh", async () => {
    const { item, review } = await pendingReview();

    const result = await moderate(review.id, "APPROVE");

    expect(result).toEqual({
      ok: true,
      changed: true,
      from: "PENDING",
      to: "APPROVED",
      revalidatePaths: [`/pokemon-tcg/${item.slug}`],
    });
    expect(
      (await db.review.findUniqueOrThrow({ where: { id: review.id } })).status,
    ).toBe("APPROVED");
    const [entry] = await auditFor(review.id);
    expect(entry).toMatchObject({
      adminUserId: admin.id,
      action: REVIEW_AUDIT_ACTIONS.approved,
      metadata: { from: "PENDING", to: "APPROVED", productId: item.id },
    });
    expect(JSON.stringify(entry)).not.toContain(review.body);
  });

  it("rejecting a pending review changes nothing public; un-publishing does", async () => {
    const { item, review } = await pendingReview();

    expect(await moderate(review.id, "REJECT")).toMatchObject({
      ok: true,
      to: "REJECTED",
      revalidatePaths: [],
    });
    expect(await moderate(review.id, "APPROVE")).toMatchObject({
      revalidatePaths: [`/pokemon-tcg/${item.slug}`],
    });
    expect(await moderate(review.id, "REJECT")).toMatchObject({
      revalidatePaths: [`/pokemon-tcg/${item.slug}`],
    });
    expect((await auditFor(review.id)).map((e) => e.action)).toEqual([
      "REJECT_REVIEW",
      "APPROVE_REVIEW",
      "REJECT_REVIEW",
    ]);
  });

  it("repeated and concurrent decisions change it once and audit once", async () => {
    const { review } = await pendingReview();

    const results = await Promise.all(
      Array.from({ length: 6 }, () => moderate(review.id, "APPROVE")),
    );

    expect(results.filter((r) => r.ok && r.changed)).toHaveLength(1);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await auditFor(review.id)).toHaveLength(1);
    expect(await db.review.count()).toBe(1);
  });

  it("requires an active administrator allowed to manage reviews", async () => {
    const { review } = await pendingReview();
    const owner = await createAdmin(db, { role: "OWNER" });
    const inactive = await createAdmin(db, { isActive: false });

    await expect(
      moderate(review.id, "APPROVE", inactive.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      moderate(review.id, "APPROVE", "0199a8c0-0000-7000-8000-0000000000aa"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await auditFor(review.id)).toHaveLength(0);
    expect(
      (await db.review.findUniqueOrThrow({ where: { id: review.id } })).status,
    ).toBe("PENDING");

    expect(await moderate(review.id, "APPROVE", owner.id)).toMatchObject({
      ok: true,
      changed: true,
    });
  });

  it("refuses unknown reviews and bad input", async () => {
    expect(
      await moderate("0199a8c0-0000-7000-8000-0000000000bb", "APPROVE"),
    ).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await moderate("x", "APPROVE")).toEqual({
      ok: false,
      error: "INVALID_INPUT",
    });
    const { review } = await pendingReview();
    expect(await moderate(review.id, "PUBLISH")).toEqual({
      ok: false,
      error: "INVALID_INPUT",
    });
  });
});

// --- Privacy --------------------------------------------------------------------------------

describe("token privacy", () => {
  it("the raw token appears in no log, audit entry or database row", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const order = await paidOrder([{ product: await product() }]);
    await ship(order.id);
    mail.queue({ fail: new EmailDeliveryError("timeout", "unknown") });
    await processDueEmails(emailDeps());
    later(RETRY_DELAYS_MS[0]!);
    await processDueEmails(emailDeps());
    const token = tokenFromEmail(order.id);

    await findOpenInvitation(db, token, now);
    await submit(token, order.items[0]!.id, { rating: "9" });
    await submit(token, order.items[0]!.id);
    await submit(token, order.items[0]!.id);
    const review = await db.review.findFirstOrThrow();
    await moderateReview(db, {
      actorId: admin.id,
      input: { reviewId: review.id, decision: "APPROVE" },
    });

    const logged = JSON.stringify([info.mock.calls, error.mock.calls]);
    expect(logged).not.toContain(token);
    const stored = JSON.stringify([
      await db.auditLog.findMany(),
      await db.emailDelivery.findMany(),
      await db.reviewToken.findMany(),
      await db.review.findMany(),
      await db.order.findMany(),
    ]);
    expect(stored).not.toContain(token);
  });
});
