import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Prisma } from "@/generated/prisma/client";
import { ForbiddenError } from "@/lib/auth/authorization";
import {
  createMemoryTransport,
  EmailDeliveryError,
} from "@/lib/email/transport";
import { getAdminDashboard } from "@/server/admin/dashboard";
import {
  ORDER_ATTENTION_AUDIT_ACTIONS,
  resolveOrderAttention,
} from "@/server/admin/orders/attention";
import { submitFulfillmentForm } from "@/server/admin/orders/fulfillment-form";
import {
  PAYMENT_RECHECK_AUDIT_ACTION,
  recheckOrderPayment,
} from "@/server/admin/orders/payment-recheck";
import {
  parseAdminOrderParams,
  type AdminOrderListParams,
} from "@/server/admin/orders/list-params";
import { getAdminOrder, listAdminOrders } from "@/server/admin/orders/queries";
import { createCheckout } from "@/server/checkout/create-checkout";
import { FakeCheckoutGateway } from "@/server/checkout/fake-gateway";
import { deriveReviewLinkKey } from "@/server/domain/review-token";
import { syncCheckoutSession } from "@/server/payments/session-sync";
import { processDueEmails, type EmailDeps } from "@/server/email/outbox";

import { createAdmin } from "./auth-helpers";
import { createProduct, paidCustomerDetails } from "./factories";
import { createTestDb, resetDatabase } from "./test-database";

/*
 * Milestone 12: admin order screens against real PostgreSQL. Fulfillment
 * runs through the form layer the server action uses, which calls the
 * Milestone 10 transition service; emails go through the real outbox with
 * a memory transport.
 */

const db = createTestDb();
const REVIEW_KEY = deriveReviewLinkKey("db-test-auth-secret-0123456789abcdef");

let owner: { id: string };
let admin: { id: string };
let mail: ReturnType<typeof createMemoryTransport>;

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
  owner = await createAdmin(db, { role: "OWNER" });
  admin = await createAdmin(db, { role: "ADMIN" });
  mail = createMemoryTransport();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(() => db.$disconnect());

const emailDeps = (): EmailDeps => ({
  db,
  transport: mail,
  siteUrl: "https://heavycards.se",
  reviewLinkKey: REVIEW_KEY,
});

const params = (query: Record<string, string> = {}): AdminOrderListParams =>
  parseAdminOrderParams(query);

/** An order with one line; paid by default, as finalization leaves it. */
async function order(
  overrides: Partial<Prisma.OrderUncheckedCreateInput> = {},
  line: {
    quantity?: number;
    unitPriceAmount?: number;
    productId?: string;
  } = {},
) {
  const productId =
    line.productId ?? (await createProduct(db, { stockOnHand: 10 })).id;
  const quantity = line.quantity ?? 1;
  const unit = line.unitPriceAmount ?? 69_900;
  return db.order.create({
    data: {
      ...paidCustomerDetails,
      subtotalAmount: unit * quantity,
      shippingAmount: 0,
      taxAmount: 0,
      totalAmount: unit * quantity,
      shippingCarrier: "POSTNORD",
      ...overrides,
      items: {
        create: {
          productId,
          productNameSnapshot: "Destined Rivals Booster Box",
          skuSnapshot: "SV10-BB-EN",
          quantity,
          unitPriceAmount: unit,
          totalPriceAmount: unit * quantity,
          vatRateBasisPoints: 2_500,
        },
      },
    },
  });
}

const pending = {
  paymentStatus: "PENDING",
  paidAt: null,
  email: null,
  customerName: null,
  addressLine1: null,
  postalCode: null,
  city: null,
} satisfies Partial<Prisma.OrderUncheckedCreateInput>;

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const ship = (actorId: string, fields: Record<string, string>) =>
  submitFulfillmentForm(db, {
    actorId,
    form: form(fields),
    reviewLinkKey: REVIEW_KEY,
  });

// --- Authorization ------------------------------------------------------------------

describe("authorization", () => {
  it("lets OWNER and ADMIN read the list and the detail", async () => {
    const paid = await order();
    for (const actor of [owner, admin]) {
      const list = await listAdminOrders(db, {
        actorId: actor.id,
        params: params(),
      });
      expect(list.rows.map((row) => row.id)).toEqual([paid.id]);
      const detail = await getAdminOrder(db, {
        actorId: actor.id,
        orderId: paid.id,
        now: new Date(),
      });
      expect(detail?.email).toBe("kund@example.com");
    }
  });

  it("refuses inactive, unknown and malformed administrators", async () => {
    const paid = await order();
    const inactive = await createAdmin(db, { role: "OWNER", isActive: false });
    for (const actorId of [
      inactive.id,
      "01999999-0000-7000-8000-000000000000",
      "not-a-uuid",
    ]) {
      await expect(
        listAdminOrders(db, { actorId, params: params() }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        getAdminOrder(db, { actorId, orderId: paid.id, now: new Date() }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        getAdminDashboard(db, {
          actorId,
          lowStockThreshold: 3,
          now: new Date(),
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("rejects fulfillment and attention changes by an inactive administrator", async () => {
    const paid = await order();
    const inactive = await createAdmin(db, { role: "ADMIN", isActive: false });
    await expect(
      ship(inactive.id, { orderId: paid.id, to: "PROCESSING" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const attention = await db.auditLog.create({
      data: {
        action: "PAYMENT_NEEDS_ATTENTION",
        entityType: "Order",
        entityId: paid.id,
        metadata: { problem: "amount_mismatch" },
      },
    });
    await expect(
      resolveOrderAttention(db, {
        actorId: inactive.id,
        input: { orderId: paid.id, attentionId: attention.id },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(
      await db.order.findUniqueOrThrow({ where: { id: paid.id } }),
    ).toMatchObject({ fulfillmentStatus: "NEW" });
  });
});

// --- List: filters, search, sorting, paging ------------------------------------------

describe("order list", () => {
  it("filters by payment and fulfillment status; hides abandoned checkouts by default", async () => {
    const fresh = await order();
    const processing = await order({ fulfillmentStatus: "PROCESSING" });
    const shipped = await order({
      fulfillmentStatus: "SHIPPED",
      shippedAt: new Date(),
    });
    const refunded = await order({
      paymentStatus: "REFUNDED",
      refundedAmount: 69_900,
    });
    const inCheckout = await order(pending);
    const abandoned = await order({ ...pending, paymentStatus: "EXPIRED" });

    const ids = async (query: Record<string, string>) =>
      (
        await listAdminOrders(db, { actorId: admin.id, params: params(query) })
      ).rows
        .map((row) => row.id)
        .sort();
    const sorted = (...list: Array<{ id: string }>) =>
      list.map((o) => o.id).sort();

    expect(await ids({})).toEqual(
      sorted(fresh, processing, shipped, refunded, inCheckout),
    );
    expect(await ids({ betalning: "alla" })).toContain(abandoned.id);
    expect(await ids({ betalning: "EXPIRED" })).toEqual([abandoned.id]);
    expect(await ids({ betalning: "betalda" })).toEqual(
      sorted(fresh, processing, shipped),
    );
    expect(
      await ids({ leverans: "att-hantera", betalning: "betalda" }),
    ).toEqual(sorted(fresh, processing));
    expect(await ids({ leverans: "SHIPPED" })).toEqual([shipped.id]);
    expect(await ids({ betalning: "nonsense" })).toEqual(await ids({}));
  });

  it("searches by public order number, Stripe ID, name and email", async () => {
    const anna = await order({
      customerName: "Anna Andersson",
      email: "anna@example.com",
      stripeCheckoutSessionId: "cs_test_anna",
      stripePaymentIntentId: "pi_test_anna",
    });
    const erik = await order({
      customerName: "Erik Eriksson",
      email: "erik@example.se",
    });
    const search = async (q: string) =>
      (
        await listAdminOrders(db, { actorId: admin.id, params: params({ q }) })
      ).rows.map((row) => row.id);

    expect(await search(`HC-${anna.orderNumber}`)).toEqual([anna.id]);
    expect(await search(`hc${erik.orderNumber}`)).toEqual([erik.id]);
    expect(await search(String(erik.orderNumber))).toEqual([erik.id]);
    expect(await search("pi_test_anna")).toEqual([anna.id]);
    expect(await search("cs_test_anna")).toEqual([anna.id]);
    expect(await search("ERIK@EXAMPLE")).toEqual([erik.id]);
    expect(await search("anna andersson")).toEqual([anna.id]);
    expect(await search("example.se")).toEqual([erik.id]);
    // LIKE wildcards are literal characters.
    expect(await search("%")).toEqual([]);
    expect(await search("HC-99999")).toEqual([]);
  });

  it("filters by Stockholm calendar day, sorts and pages", async () => {
    // 2026-03-10 23:30 in Stockholm is 22:30 UTC: still the 10th there.
    const late = await order(
      { createdAt: new Date("2026-03-10T22:30:00Z") },
      { unitPriceAmount: 10_000 },
    );
    const nextDay = await order(
      { createdAt: new Date("2026-03-10T23:30:00Z") },
      { unitPriceAmount: 30_000 },
    );
    const earlier = await order(
      { createdAt: new Date("2026-03-01T10:00:00Z") },
      { unitPriceAmount: 20_000 },
    );
    const list = (query: Record<string, string>, pageSize?: number) =>
      listAdminOrders(db, {
        actorId: admin.id,
        params: params(query),
        pageSize,
      });

    expect(
      (await list({ fran: "2026-03-10", till: "2026-03-10" })).rows.map(
        (r) => r.id,
      ),
    ).toEqual([late.id]);
    expect((await list({ fran: "2026-03-11" })).rows.map((r) => r.id)).toEqual([
      nextDay.id,
    ]);
    expect((await list({ till: "2026-03-09" })).rows.map((r) => r.id)).toEqual([
      earlier.id,
    ]);
    // An invalid date is ignored rather than rejected.
    expect((await list({ fran: "2026-02-30" })).total).toBe(3);

    expect((await list({})).rows.map((r) => r.id)).toEqual([
      nextDay.id,
      late.id,
      earlier.id,
    ]);
    expect((await list({ sortering: "belopp" })).rows.map((r) => r.id)).toEqual(
      [nextDay.id, earlier.id, late.id],
    );

    const second = await list({ sida: "2" }, 2);
    expect(second).toMatchObject({ total: 3, page: 2, pageCount: 2 });
    expect(second.rows.map((r) => r.id)).toEqual([earlier.id]);
    // Past the end falls back to the last page.
    const beyond = await list({ sida: "9" }, 2);
    expect(beyond.page).toBe(2);
    expect(beyond.rows).toHaveLength(1);
  });

  it("shows only the name of the customer, units and open attention", async () => {
    const paid = await order({}, { quantity: 3 });
    await db.auditLog.create({
      data: {
        action: "EMAIL_NEEDS_ATTENTION",
        entityType: "Order",
        entityId: paid.id,
        metadata: { kind: "ORDER_CONFIRMATION", problem: "max_attempts" },
      },
    });
    const [row] = (
      await listAdminOrders(db, { actorId: admin.id, params: params() })
    ).rows;
    expect(row).toMatchObject({
      customerName: "Kim Kund",
      units: 3,
      openAttention: 1,
    });
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("kund@example.com");
    expect(serialized).not.toContain("Testgatan");
  });
});

// --- Detail ------------------------------------------------------------------------

describe("order detail", () => {
  it("shows historic snapshots even after the product changed", async () => {
    const product = await createProduct(db, {
      name: "Destined Rivals Booster Box",
      priceAmount: 149_900,
    });
    const paid = await order(
      { stripePaymentIntentId: "pi_test_123", phone: "+46701234567" },
      { productId: product.id, quantity: 2, unitPriceAmount: 149_900 },
    );
    await db.product.update({
      where: { id: product.id },
      data: { name: "Omdöpt produkt", priceAmount: 179_900, sku: "NEW-SKU" },
    });

    const detail = await getAdminOrder(db, {
      actorId: admin.id,
      orderId: paid.id,
      now: new Date(),
    });
    expect(detail).toMatchObject({
      orderNumber: paid.orderNumber,
      customerName: "Kim Kund",
      email: "kund@example.com",
      phone: "+46701234567",
      addressLine1: "Testgatan 1",
      postalCode: "111 22",
      city: "Stockholm",
      totalAmount: 299_800,
      stripePaymentIntentId: "pi_test_123",
      items: [
        {
          productNameSnapshot: "Destined Rivals Booster Box",
          skuSnapshot: "SV10-BB-EN",
          quantity: 2,
          unitPriceAmount: 149_900,
          totalPriceAmount: 299_800,
        },
      ],
    });
  });

  it("returns null for an unknown order", async () => {
    expect(
      await getAdminOrder(db, {
        actorId: admin.id,
        orderId: "01999999-0000-7000-8000-000000000000",
        now: new Date(),
      }),
    ).toBeNull();
  });
});

// --- Fulfillment ---------------------------------------------------------------------

describe("fulfillment through the shared service", () => {
  it("moves a paid order to SHIPPED: one email obligation and one review invitation", async () => {
    const paid = await order();

    const processing = await ship(admin.id, {
      orderId: paid.id,
      to: "PROCESSING",
    });
    expect(processing).toEqual({
      state: { status: "success", message: "Leveransstatus: Behandlas." },
      emailDeliveryIds: [],
    });

    const shipped = await ship(admin.id, {
      orderId: paid.id,
      to: "SHIPPED",
      shippingCarrier: "POSTNORD",
      trackingNumber: " RR123456785SE ",
    });
    expect(shipped.state).toMatchObject({ status: "success" });
    expect(shipped.emailDeliveryIds).toHaveLength(1);

    const stored = await db.order.findUniqueOrThrow({
      where: { id: paid.id },
      include: { emailDeliveries: true, reviewToken: true },
    });
    expect(stored).toMatchObject({
      fulfillmentStatus: "SHIPPED",
      trackingNumber: "RR123456785SE",
      shippingCarrier: "POSTNORD",
    });
    expect(stored.shippedAt).toBeInstanceOf(Date);
    expect(stored.emailDeliveries.map((d) => d.kind)).toEqual([
      "ORDER_SHIPPED",
    ]);
    expect(stored.reviewToken).not.toBeNull();

    await processDueEmails(emailDeps(), { orderId: paid.id });
    expect(mail.calls).toHaveLength(1);
    expect(mail.calls[0]!.message.text).toContain("RR123456785SE");
    expect(mail.calls[0]!.message.text).toMatch(/\/review\/[\w-]{43}/);

    const audit = await db.auditLog.findMany({
      where: { entityId: paid.id, action: "UPDATE_ORDER_STATUS" },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((entry) => entry.adminUserId)).toEqual([
      admin.id,
      admin.id,
    ]);
  });

  it("a repeated SHIPPED save changes nothing and sends nothing", async () => {
    const paid = await order({ fulfillmentStatus: "PROCESSING" });
    const fields = {
      orderId: paid.id,
      to: "SHIPPED",
      shippingCarrier: "POSTNORD",
      trackingNumber: "RR123456785SE",
    };
    await ship(admin.id, fields);
    await processDueEmails(emailDeps(), { orderId: paid.id });

    const again = await Promise.all([
      ship(admin.id, fields),
      ship(owner.id, fields),
    ]);
    for (const result of again) {
      expect(result).toEqual({
        state: { status: "success", message: "Inget att ändra." },
        emailDeliveryIds: [],
      });
    }
    await processDueEmails(emailDeps(), { orderId: paid.id });

    expect(mail.calls).toHaveLength(1);
    expect(await db.emailDelivery.count()).toBe(1);
    expect(await db.reviewToken.count()).toBe(1);
  });

  it("a tracking correction updates the order without another email", async () => {
    const paid = await order({ fulfillmentStatus: "PROCESSING" });
    await ship(admin.id, {
      orderId: paid.id,
      to: "SHIPPED",
      shippingCarrier: "POSTNORD",
      trackingNumber: "RR111111111SE",
    });
    await processDueEmails(emailDeps(), { orderId: paid.id });
    const { shippedAt } = await db.order.findUniqueOrThrow({
      where: { id: paid.id },
    });

    const corrected = await ship(owner.id, {
      orderId: paid.id,
      to: "SHIPPED",
      shippingCarrier: "OTHER",
      trackingNumber: "RR222222222SE",
    });
    expect(corrected).toEqual({
      state: {
        status: "success",
        message:
          "Spårningsuppgifterna är uppdaterade. Inget nytt mejl skickas.",
      },
      emailDeliveryIds: [],
    });
    await processDueEmails(emailDeps(), { orderId: paid.id });

    const stored = await db.order.findUniqueOrThrow({
      where: { id: paid.id },
    });
    expect(stored).toMatchObject({
      trackingNumber: "RR222222222SE",
      shippingCarrier: "OTHER",
      shippedAt,
    });
    expect(mail.calls).toHaveLength(1);
    expect(
      await db.auditLog.findFirst({
        where: { entityId: paid.id, action: "UPDATE_ORDER_TRACKING" },
      }),
    ).toMatchObject({
      adminUserId: owner.id,
      metadata: {
        from: { trackingNumber: "RR111111111SE", shippingCarrier: "POSTNORD" },
        to: { trackingNumber: "RR222222222SE", shippingCarrier: "OTHER" },
      },
    });
  });

  it("does not let other transitions touch the tracking details", async () => {
    const paid = await order({
      fulfillmentStatus: "SHIPPED",
      shippedAt: new Date(),
      trackingNumber: "RR123456785SE",
    });
    await ship(admin.id, {
      orderId: paid.id,
      to: "COMPLETED",
      trackingNumber: "",
    });
    expect(
      await db.order.findUniqueOrThrow({ where: { id: paid.id } }),
    ).toMatchObject({
      fulfillmentStatus: "COMPLETED",
      trackingNumber: "RR123456785SE",
    });
  });

  it("explains refused transitions in Swedish", async () => {
    const unpaid = await order(pending);
    expect(
      (await ship(admin.id, { orderId: unpaid.id, to: "PROCESSING" })).state,
    ).toEqual({
      status: "error",
      message:
        "Betalningen pågår fortfarande hos Stripe, så beställningen kan inte ändras ännu. Den avslutas av sig själv när kunden betalar eller kassan går ut. Använd ”Kontrollera med Stripe igen” om den väntat länge.",
    });

    const fresh = await order();
    expect(
      (
        await ship(admin.id, {
          orderId: fresh.id,
          to: "SHIPPED",
          shippingCarrier: "POSTNORD",
        })
      ).state,
    ).toMatchObject({
      status: "error",
      message: expect.stringContaining("kan inte gå från ny till skickad"),
    });

    const processing = await order({ fulfillmentStatus: "PROCESSING" });
    expect(
      (
        await ship(admin.id, {
          orderId: processing.id,
          to: "SHIPPED",
          shippingCarrier: "POSTNORD",
          trackingNumber: "<script>",
        })
      ).state,
    ).toEqual({
      status: "error",
      message: "Kontrollera de markerade fälten.",
      fieldErrors: {
        trackingNumber:
          "Spårningsnumret får bara innehålla bokstäver, siffror, mellanslag och - . / _",
      },
    });
    expect(
      (await ship(admin.id, { orderId: "x", to: "PROCESSING" })).state,
    ).toEqual({
      status: "error",
      message: "Ogiltig begäran. Ladda om sidan och försök igen.",
    });
    expect(await db.emailDelivery.count()).toBe(0);
  });
});

// --- Refunds -------------------------------------------------------------------------

describe("refund visibility", () => {
  it("shows the refunded amount and status without touching inventory", async () => {
    const product = await createProduct(db, { stockOnHand: 4 });
    const refunded = await order(
      { paymentStatus: "PARTIALLY_REFUNDED", refundedAmount: 20_000 },
      { productId: product.id, quantity: 2, unitPriceAmount: 50_000 },
    );
    await db.auditLog.create({
      data: {
        action: "SYNC_ORDER_REFUND",
        entityType: "Order",
        entityId: refunded.id,
        metadata: {
          from: "PAID",
          to: "PARTIALLY_REFUNDED",
          refundedAmount: 20_000,
        },
      },
    });

    const detail = await getAdminOrder(db, {
      actorId: admin.id,
      orderId: refunded.id,
      now: new Date(),
    });
    await listAdminOrders(db, { actorId: admin.id, params: params() });
    await getAdminDashboard(db, {
      actorId: admin.id,
      lowStockThreshold: 3,
      now: new Date(),
    });

    expect(detail).toMatchObject({
      paymentStatus: "PARTIALLY_REFUNDED",
      refundedAmount: 20_000,
      totalAmount: 100_000,
    });
    expect(detail!.events.map((event) => event.action)).toEqual([
      "SYNC_ORDER_REFUND",
    ]);
    expect(
      await db.product.findUniqueOrThrow({ where: { id: product.id } }),
    ).toMatchObject({ stockOnHand: 4 });
    expect(await db.inventoryReservation.count()).toBe(0);
  });
});

// --- Needs attention and the dashboard ---------------------------------------------------

describe("needs attention", () => {
  async function attention(
    orderId: string,
    action: string,
    metadata: Prisma.InputJsonObject,
  ) {
    return db.auditLog.create({
      data: { action, entityType: "Order", entityId: orderId, metadata },
    });
  }

  it("counts open payment, email and stock problems and lets staff mark them handled", async () => {
    const mismatch = await order({ ...pending });
    const shortfall = await order();
    const fine = await order();
    const payment = await attention(mismatch.id, "PAYMENT_NEEDS_ATTENTION", {
      problem: "amount_mismatch",
      source: "webhook",
    });
    await attention(shortfall.id, "MARK_ORDER_PAID", {
      source: "webhook",
      stockShortfalls: [{ productId: "p", missing: 1 }],
    });
    // A normal payment without shortfall is not a problem.
    await attention(fine.id, "MARK_ORDER_PAID", { source: "webhook" });

    // A real email failure: the provider refuses the idempotency key.
    const confirmation = await db.emailDelivery.create({
      data: { orderId: fine.id, kind: "ORDER_CONFIRMATION" },
    });
    mail.queue({
      fail: new EmailDeliveryError("invalid_idempotent_request", "conflict"),
    });
    await processDueEmails(emailDeps(), { orderId: fine.id });
    expect(
      await db.emailDelivery.findUniqueOrThrow({
        where: { id: confirmation.id },
      }),
    ).toMatchObject({ status: "FAILED" });

    const dashboard = () =>
      getAdminDashboard(db, {
        actorId: admin.id,
        lowStockThreshold: 3,
        now: new Date(),
      });
    expect((await dashboard()).attention).toMatchObject({
      orders: 3,
      payment: 1,
      email: 1,
      stock: 1,
    });
    // The default list hides nothing here: the pending order is included.
    const flagged = await listAdminOrders(db, {
      actorId: admin.id,
      params: params({ atgard: "1" }),
    });
    expect(flagged.rows.map((row) => row.id).sort()).toEqual(
      [mismatch.id, shortfall.id, fine.id].sort(),
    );

    const detail = await getAdminOrder(db, {
      actorId: admin.id,
      orderId: mismatch.id,
      now: new Date(),
    });
    expect(detail!.attention.map((item) => item.id)).toEqual([payment.id]);

    const resolved = await Promise.all(
      [admin, owner].map((actor) =>
        resolveOrderAttention(db, {
          actorId: actor.id,
          input: { orderId: mismatch.id, attentionId: payment.id },
        }),
      ),
    );
    expect(
      resolved.map((result) => result.ok && result.changed).sort(),
    ).toEqual([false, true]);
    expect(
      await db.auditLog.count({
        where: { action: ORDER_ATTENTION_AUDIT_ACTIONS.resolved },
      }),
    ).toBe(1);
    expect((await dashboard()).attention).toMatchObject({
      orders: 2,
      payment: 0,
    });
    // Only the attention list changes: the order is untouched.
    expect(
      await db.order.findUniqueOrThrow({ where: { id: mismatch.id } }),
    ).toMatchObject({ paymentStatus: "PENDING", fulfillmentStatus: "NEW" });
  });

  it("refuses to resolve entries that are not attention items or belong to another order", async () => {
    const one = await order();
    const other = await order();
    const normal = await attention(one.id, "MARK_ORDER_PAID", {
      source: "webhook",
    });
    const foreign = await attention(other.id, "PAYMENT_NEEDS_ATTENTION", {
      problem: "missing_payment",
    });
    for (const attentionId of [normal.id, foreign.id]) {
      expect(
        await resolveOrderAttention(db, {
          actorId: admin.id,
          input: { orderId: one.id, attentionId },
        }),
      ).toEqual({ ok: false, error: "NOT_FOUND" });
    }
    expect(
      await resolveOrderAttention(db, {
        actorId: admin.id,
        input: { orderId: one.id, attentionId: "nope" },
      }),
    ).toEqual({ ok: false, error: "INVALID_INPUT" });
  });
});

describe("dashboard", () => {
  it("counts work, reviews, low stock, queued email and recent sales with aggregates", async () => {
    const now = new Date("2026-10-02T12:00:00Z");
    const day = 86_400_000;
    const low = await createProduct(db, {
      stockOnHand: 2,
      publishedAt: new Date(now.getTime() - day),
    });
    await createProduct(db, {
      stockOnHand: 50,
      publishedAt: new Date(now.getTime() - day),
    });
    // A draft with low stock is not listed.
    await createProduct(db, { status: "DRAFT", stockOnHand: 0 });

    const recent = new Date(now.getTime() - 2 * day);
    const toStart = await order(
      { paidAt: recent },
      { unitPriceAmount: 100_000 },
    );
    await order(
      { paidAt: recent, fulfillmentStatus: "PROCESSING" },
      { unitPriceAmount: 50_000 },
    );
    await order(
      { paidAt: recent, paymentStatus: "REFUNDED", refundedAmount: 30_000 },
      { unitPriceAmount: 30_000 },
    );
    await order(
      {
        paidAt: new Date(now.getTime() - 40 * day),
        fulfillmentStatus: "COMPLETED",
        shippedAt: new Date(now.getTime() - 39 * day),
      },
      { unitPriceAmount: 999_900 },
    );
    await order(pending, { unitPriceAmount: 777_700 });

    const reviewed = await order(
      { fulfillmentStatus: "SHIPPED", shippedAt: recent },
      {},
    );
    const item = await db.orderItem.findFirstOrThrow({
      where: { orderId: reviewed.id },
    });
    await db.review.create({
      data: {
        productId: item.productId,
        orderItemId: item.id,
        displayName: "Kim",
        rating: 5,
        body: "Mycket bra produkt.",
        verifiedPurchase: true,
      },
    });
    await db.emailDelivery.create({
      data: {
        orderId: toStart.id,
        kind: "ORDER_CONFIRMATION",
        attempts: 2,
        nextAttemptAt: new Date(now.getTime() - 60 * 60 * 1000),
      },
    });

    const dashboard = await getAdminDashboard(db, {
      actorId: owner.id,
      lowStockThreshold: 3,
      now,
    });
    expect(dashboard.orders).toEqual({
      toStart: 1,
      processing: 1,
      refundedOpen: 1,
    });
    expect(dashboard.pendingReviews).toBe(1);
    expect(dashboard.lowStock.total).toBe(1);
    expect(dashboard.lowStock.rows.map((row) => row.id)).toEqual([low.id]);
    expect(dashboard.emails).toEqual({ retrying: 1, overdue: 1 });
    // Paid in the last 30 days: the three recent paid states, never the
    // pending checkout or the order paid 40 days ago.
    expect(dashboard.sales).toMatchObject({
      orders: 3,
      grossAmount: 180_000,
      refundedAmount: 30_000,
      netAmount: 150_000,
    });
    expect(dashboard.recentOrders).toHaveLength(6);
    expect(dashboard.attention.orders).toBe(0);
  });

  it("lists the latest order events with their order numbers in one extra query", async () => {
    const paid = await order({ fulfillmentStatus: "PROCESSING" });
    await ship(admin.id, {
      orderId: paid.id,
      to: "SHIPPED",
      shippingCarrier: "POSTNORD",
      trackingNumber: "",
    });
    const { recentEvents } = await getAdminDashboard(db, {
      actorId: admin.id,
      lowStockThreshold: 3,
      now: new Date(),
    });
    expect(recentEvents).toMatchObject([
      {
        orderId: paid.id,
        orderNumber: paid.orderNumber,
        action: "UPDATE_ORDER_STATUS",
        actorName: expect.stringMatching(/^Admin /),
      },
    ]);
  });
});

// --- Payment problems that still hold stock -------------------------------------------

describe("payment problems that still block stock", () => {
  let gateway: FakeCheckoutGateway;
  beforeEach(() => {
    gateway = new FakeCheckoutGateway();
  });

  const payments = () => ({ db, gateway });

  /**
   * A real checkout (attached Stripe session, reservation awaiting payment)
   * whose payment Stripe reports with the wrong amount: the Milestone 9
   * service records PAYMENT_NEEDS_ATTENTION and keeps the stock reserved.
   */
  async function blockedCheckout(quantity = 2) {
    const product = await createProduct(db, {
      priceAmount: 50_000,
      stockOnHand: 5,
      publishedAt: new Date(Date.now() - 86_400_000),
    });
    const outcome = await createCheckout(
      { db, gateway, siteUrl: "https://heavycards.se" },
      {
        attemptId: randomUUID(),
        lines: [
          { productId: product.id, quantity, expectedUnitPriceAmount: 50_000 },
        ],
      },
    );
    expect(outcome.ok).toBe(true);
    const pendingOrder = await db.order.findFirstOrThrow({
      where: { items: { some: { productId: product.id } } },
    });
    const sessionId = pendingOrder.stripeCheckoutSessionId!;
    gateway.completeSession(sessionId, { amountTotal: 1 });
    expect(
      (await syncCheckoutSession(payments(), sessionId, { source: "webhook" }))
        .outcome,
    ).toBe("needs_attention");
    const attention = await db.auditLog.findFirstOrThrow({
      where: { entityId: pendingOrder.id, action: "PAYMENT_NEEDS_ATTENTION" },
    });
    return { product, order: pendingOrder, sessionId, attention };
  }

  const holds = (orderId: string) =>
    db.inventoryReservation.findMany({
      where: { orderId },
      select: { status: true, awaitingPayment: true, quantity: true },
    });
  const openPaymentProblems = async () =>
    (
      await getAdminDashboard(db, {
        actorId: admin.id,
        lowStockThreshold: 3,
        now: new Date(),
      })
    ).attention.payment;
  const resolve = (orderId: string, attentionId: string, actorId = admin.id) =>
    resolveOrderAttention(db, { actorId, input: { orderId, attentionId } });

  it("cannot be marked handled while the reservation holds stock", async () => {
    const { order, attention } = await blockedCheckout();

    const attempts = await Promise.all([
      resolve(order.id, attention.id),
      resolve(order.id, attention.id, owner.id),
      resolve(order.id, attention.id),
    ]);
    for (const result of attempts) {
      expect(result).toEqual({
        ok: false,
        error: "STILL_BLOCKING",
        heldUnits: 2,
      });
    }
    expect(
      await db.auditLog.count({
        where: { action: ORDER_ATTENTION_AUDIT_ACTIONS.resolved },
      }),
    ).toBe(0);
    expect(await holds(order.id)).toEqual([
      { status: "ACTIVE", awaitingPayment: true, quantity: 2 },
    ]);

    // Still visible everywhere staff look.
    expect(await openPaymentProblems()).toBe(1);
    const flagged = await listAdminOrders(db, {
      actorId: admin.id,
      params: params({ atgard: "1" }),
    });
    expect(flagged.rows.map((row) => row.id)).toEqual([order.id]);
    const detail = await getAdminOrder(db, {
      actorId: admin.id,
      orderId: order.id,
      now: new Date(),
    });
    expect(detail).toMatchObject({ paymentStatus: "PENDING", heldUnits: 2 });
    expect(detail!.attention.map((item) => item.id)).toEqual([attention.id]);
  });

  it("stays open while the hold lasts even if a resolution entry exists", async () => {
    const { order, attention } = await blockedCheckout();
    // For example written before this rule existed, or by hand.
    await db.auditLog.create({
      data: {
        adminUserId: admin.id,
        action: ORDER_ATTENTION_AUDIT_ACTIONS.resolved,
        entityType: "Order",
        entityId: order.id,
        metadata: { attentionId: attention.id, kind: "payment" },
      },
    });
    expect(await openPaymentProblems()).toBe(1);
    const detail = await getAdminOrder(db, {
      actorId: admin.id,
      orderId: order.id,
      now: new Date(),
    });
    expect(detail!.attention).toHaveLength(1);
  });

  it("rechecking keeps the hold when Stripe still disagrees or cannot be reached", async () => {
    const { order, attention } = await blockedCheckout();

    expect(
      await recheckOrderPayment(payments(), {
        actorId: admin.id,
        input: { orderId: order.id },
      }),
    ).toMatchObject({ ok: true, outcome: "needs_attention", productSlugs: [] });

    gateway.unavailable = true;
    expect(
      await recheckOrderPayment(payments(), {
        actorId: owner.id,
        input: { orderId: order.id },
      }),
    ).toEqual({ ok: false, error: "UNAVAILABLE" });

    expect(await holds(order.id)).toEqual([
      { status: "ACTIVE", awaitingPayment: true, quantity: 2 },
    ]);
    expect(
      await db.order.findUniqueOrThrow({ where: { id: order.id } }),
    ).toMatchObject({ paymentStatus: "PENDING" });
    expect(await resolve(order.id, attention.id)).toMatchObject({
      error: "STILL_BLOCKING",
    });
    expect(await openPaymentProblems()).toBe(1);
    // Each recheck is audited with its outcome; the problem is recorded once.
    const audit = await db.auditLog.findMany({
      where: { entityId: order.id },
      orderBy: { createdAt: "asc" },
      select: { action: true, adminUserId: true, metadata: true },
    });
    expect(audit).toEqual([
      expect.objectContaining({ action: "PAYMENT_NEEDS_ATTENTION" }),
      {
        action: PAYMENT_RECHECK_AUDIT_ACTION,
        adminUserId: admin.id,
        metadata: { outcome: "needs_attention" },
      },
      {
        action: PAYMENT_RECHECK_AUDIT_ACTION,
        adminUserId: owner.id,
        metadata: { outcome: "unavailable" },
      },
    ]);
  });

  it("releases the stock only when Stripe reports the checkout expired unpaid", async () => {
    const { order, sessionId, product, attention } = await blockedCheckout();
    // Stripe's authoritative state is now: expired, never paid.
    Object.assign(gateway.session(sessionId)!, {
      status: "expired",
      paymentStatus: "unpaid",
      paymentIntent: null,
    });

    expect(
      await recheckOrderPayment(payments(), {
        actorId: admin.id,
        input: { orderId: order.id },
      }),
    ).toMatchObject({
      ok: true,
      outcome: "expired",
      productSlugs: [product.slug],
    });
    expect(
      await db.order.findUniqueOrThrow({ where: { id: order.id } }),
    ).toMatchObject({ paymentStatus: "EXPIRED" });
    expect((await holds(order.id)).map((hold) => hold.status)).toEqual([
      "RELEASED",
    ]);
    // Stock was never decremented: all 5 can be sold again.
    expect(
      await db.product.findUniqueOrThrow({ where: { id: product.id } }),
    ).toMatchObject({ stockOnHand: 5 });

    // The condition is safe now, so the historical item can be acknowledged.
    expect(await resolve(order.id, attention.id)).toEqual({
      ok: true,
      changed: true,
    });
    expect(await openPaymentProblems()).toBe(0);
  });

  it("finalizes through the payment service when Stripe confirms a consistent payment", async () => {
    const { order, sessionId, product, attention } = await blockedCheckout();
    gateway.completeSession(sessionId, { amountTotal: order.totalAmount });

    expect(
      await recheckOrderPayment(payments(), {
        actorId: admin.id,
        input: { orderId: order.id },
      }),
    ).toMatchObject({ ok: true, outcome: "paid" });
    const stored = await db.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { emailDeliveries: true },
    });
    expect(stored.paymentStatus).toBe("PAID");
    expect(stored.emailDeliveries.map((delivery) => delivery.kind)).toEqual([
      "ORDER_CONFIRMATION",
    ]);
    expect((await holds(order.id)).map((hold) => hold.status)).toEqual([
      "CONSUMED",
    ]);
    expect(
      await db.product.findUniqueOrThrow({ where: { id: product.id } }),
    ).toMatchObject({ stockOnHand: 3 });
    expect(await resolve(order.id, attention.id)).toMatchObject({ ok: true });
  });

  it("does not recheck closed orders, and refuses inactive administrators before contacting Stripe", async () => {
    const paid = await order();
    expect(
      await recheckOrderPayment(payments(), {
        actorId: admin.id,
        input: { orderId: paid.id },
      }),
    ).toEqual({ ok: false, error: "NOT_APPLICABLE" });

    const { order: blocked } = await blockedCheckout();
    const calls = gateway.retrieveCalls;
    const inactive = await createAdmin(db, { role: "ADMIN", isActive: false });
    await expect(
      recheckOrderPayment(payments(), {
        actorId: inactive.id,
        input: { orderId: blocked.id },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(gateway.retrieveCalls).toBe(calls);
    expect(
      await recheckOrderPayment(payments(), {
        actorId: admin.id,
        input: { orderId: "nope" },
      }),
    ).toEqual({ ok: false, error: "INVALID_INPUT" });
  });
});
