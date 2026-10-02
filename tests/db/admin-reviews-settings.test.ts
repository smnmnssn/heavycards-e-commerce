import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/lib/auth/authorization";
import { listAdminProducts } from "@/server/admin/catalog/queries";
import {
  listAdminReviews,
  parseAdminReviewParams,
} from "@/server/admin/reviews/queries";
import {
  getStoreSettingsForAdmin,
  SETTINGS_AUDIT_ACTIONS,
  updateStoreSettings,
} from "@/server/admin/settings/store-settings";
import { createCheckout } from "@/server/checkout/create-checkout";
import { FakeCheckoutGateway } from "@/server/checkout/fake-gateway";
import { moderateReview } from "@/server/reviews/moderation";

import { createAdmin } from "./auth-helpers";
import { createProduct, paidCustomerDetails } from "./factories";
import { createTestDb, resetDatabase } from "./test-database";

/*
 * Milestone 12: review moderation screens and store settings against real
 * PostgreSQL. Moderation runs through the Milestone 11 service the admin
 * action calls; settings changes are verified by real checkouts.
 */

const db = createTestDb();
const DAY_MS = 86_400_000;

let owner: { id: string };
let admin: { id: string };

const SETTINGS = {
  id: 1,
  storeName: "HeavyCards",
  contactEmail: "kundservice@heavycards.se",
  shippingPriceAmount: 7_900,
  freeShippingThresholdAmount: 150_000,
  vatRateBasisPoints: 2_500,
  lowStockThreshold: 3,
};

beforeEach(async () => {
  await resetDatabase(db);
  owner = await createAdmin(db, { role: "OWNER" });
  admin = await createAdmin(db, { role: "ADMIN" });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(() => db.$disconnect());

// --- Reviews -----------------------------------------------------------------------

async function shippedLine(productName = "Destined Rivals ETB") {
  const token = {
    nonce: randomBytes(32).toString("base64url"),
    tokenHash: randomBytes(32).toString("hex"),
  };
  const product = await createProduct(db, {
    name: productName,
    publishedAt: new Date(Date.now() - DAY_MS),
  });
  const order = await db.order.create({
    data: {
      ...paidCustomerDetails,
      fulfillmentStatus: "SHIPPED",
      shippedAt: new Date(),
      subtotalAmount: product.priceAmount,
      shippingAmount: 0,
      taxAmount: 0,
      totalAmount: product.priceAmount,
      items: {
        create: {
          productId: product.id,
          productNameSnapshot: product.name,
          skuSnapshot: product.sku,
          quantity: 1,
          unitPriceAmount: product.priceAmount,
          totalPriceAmount: product.priceAmount,
          vatRateBasisPoints: 2_500,
        },
      },
      reviewToken: {
        create: {
          ...token,
          expiresAt: new Date(Date.now() + 180 * DAY_MS),
        },
      },
    },
    include: { items: true },
  });
  return { product, order, item: order.items[0]!, token };
}

async function review(
  status: "PENDING" | "APPROVED" | "REJECTED" = "PENDING",
  createdAt = new Date(),
) {
  const line = await shippedLine();
  const row = await db.review.create({
    data: {
      productId: line.product.id,
      orderItemId: line.item.id,
      displayName: "Anna A.",
      rating: 4,
      title: "Bra",
      body: "Snabb leverans och fint skick.",
      verifiedPurchase: true,
      status,
      createdAt,
    },
  });
  return { ...line, review: row };
}

const reviews = (query: Record<string, string> = {}, actorId = admin.id) =>
  listAdminReviews(db, { actorId, params: parseAdminReviewParams(query) });

describe("review moderation screen", () => {
  it("shows pending reviews first in arrival order, with product, order and counts", async () => {
    const older = await review("PENDING", new Date(Date.now() - DAY_MS));
    const newer = await review("PENDING");
    await review("APPROVED");
    await review("REJECTED");

    const list = await reviews();
    expect(list.counts).toEqual({ PENDING: 2, APPROVED: 1, REJECTED: 1 });
    expect(list.total).toBe(2);
    expect(list.rows.map((row) => row.id)).toEqual([
      older.review.id,
      newer.review.id,
    ]);
    expect(list.rows[0]).toMatchObject({
      rating: 4,
      title: "Bra",
      body: "Snabb leverans och fint skick.",
      displayName: "Anna A.",
      verifiedPurchase: true,
      status: "PENDING",
      product: { id: older.product.id, name: "Destined Rivals ETB" },
      order: { id: older.order.id, orderNumber: older.order.orderNumber },
    });
    expect((await reviews({ sortering: "nyast" })).rows[0]!.id).toBe(
      newer.review.id,
    );
    expect((await reviews({ status: "alla" })).total).toBe(4);
    expect((await reviews({ status: "APPROVED" })).total).toBe(1);
  });

  it("never exposes review invitation tokens or customer contact data", async () => {
    const { token } = await review();
    const serialized = JSON.stringify(await reviews());
    expect(serialized).not.toContain(token.tokenHash);
    expect(serialized).not.toContain(token.nonce);
    expect(serialized).not.toContain("kund@example.com");
    expect(serialized).not.toContain("Kim Kund");
  });

  it("moderates a pending review, reverses it and never deletes it", async () => {
    const { review: pending, product } = await review();

    const approved = await moderateReview(db, {
      actorId: admin.id,
      input: { reviewId: pending.id, decision: "APPROVE" },
    });
    expect(approved).toMatchObject({
      ok: true,
      changed: true,
      to: "APPROVED",
      revalidatePaths: [`/pokemon-tcg/${product.slug}`],
    });
    expect((await reviews()).counts).toEqual({
      PENDING: 0,
      APPROVED: 1,
      REJECTED: 0,
    });

    const rejected = await moderateReview(db, {
      actorId: owner.id,
      input: { reviewId: pending.id, decision: "REJECT" },
    });
    expect(rejected).toMatchObject({ ok: true, to: "REJECTED" });
    expect(
      await moderateReview(db, {
        actorId: owner.id,
        input: { reviewId: pending.id, decision: "APPROVE" },
      }),
    ).toMatchObject({ ok: true, to: "APPROVED" });

    // Rejection is the removal mechanism; the row (the entitlement) stays.
    expect(await db.review.count()).toBe(1);
    const audit = await db.auditLog.findMany({
      where: { entityType: "Review", entityId: pending.id },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((entry) => entry.action)).toEqual([
      "APPROVE_REVIEW",
      "REJECT_REVIEW",
      "APPROVE_REVIEW",
    ]);
  });

  it("has no delete decision", async () => {
    const { review: pending } = await review();
    expect(
      await moderateReview(db, {
        actorId: admin.id,
        input: { reviewId: pending.id, decision: "DELETE" },
      }),
    ).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await db.review.count()).toBe(1);
  });

  it("refuses inactive administrators for reading and moderating", async () => {
    const { review: pending } = await review();
    const inactive = await createAdmin(db, { role: "OWNER", isActive: false });
    await expect(reviews({}, inactive.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      moderateReview(db, {
        actorId: inactive.id,
        input: { reviewId: pending.id, decision: "APPROVE" },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(
      await db.review.findUniqueOrThrow({ where: { id: pending.id } }),
    ).toMatchObject({ status: "PENDING" });
  });
});

// --- Store settings ------------------------------------------------------------------

const formValues = (overrides: Record<string, string> = {}) => ({
  storeName: "HeavyCards",
  contactEmail: "kundservice@heavycards.se",
  companyName: "HeavyCards AB",
  organizationNumber: "2021005448",
  shippingPrice: "79",
  freeShippingThreshold: "1500",
  defaultShippingCarrier: "POSTNORD",
  vatRate: "2500",
  lowStockThreshold: "3",
  defaultSeoTitle: "",
  defaultSeoDescription: "",
  ...overrides,
});

async function checkoutShipping(priceAmount: number) {
  const product = await createProduct(db, {
    priceAmount,
    stockOnHand: 5,
    publishedAt: new Date(Date.now() - DAY_MS),
  });
  const outcome = await createCheckout(
    {
      db,
      gateway: new FakeCheckoutGateway(),
      siteUrl: "http://localhost:3100",
    },
    {
      attemptId: randomUUID(),
      lines: [
        {
          productId: product.id,
          quantity: 1,
          expectedUnitPriceAmount: priceAmount,
        },
      ],
    },
  );
  expect(outcome.ok).toBe(true);
  return db.order.findFirstOrThrow({
    where: { items: { some: { productId: product.id } } },
    include: { items: true },
  });
}

describe("store settings", () => {
  beforeEach(async () => {
    await db.storeSettings.create({ data: SETTINGS });
  });

  it("lets an OWNER save SEK values as öre, with an audit entry of old and new values", async () => {
    const result = await updateStoreSettings(db, {
      actorId: owner.id,
      input: formValues({
        shippingPrice: "49,50",
        freeShippingThreshold: "1 000",
        lowStockThreshold: "5",
        contactEmail: "hej@heavycards.se",
        organizationNumber: "202100-5448",
      }),
    });
    expect(result).toEqual({
      ok: true,
      created: false,
      changed: [
        "contactEmail",
        "companyName",
        "organizationNumber",
        "shippingPriceAmount",
        "freeShippingThresholdAmount",
        "lowStockThreshold",
      ],
      revalidate: [{ path: "/", type: "layout" }],
    });
    expect(
      await db.storeSettings.findUniqueOrThrow({ where: { id: 1 } }),
    ).toMatchObject({
      contactEmail: "hej@heavycards.se",
      companyName: "HeavyCards AB",
      organizationNumber: "202100-5448",
      shippingPriceAmount: 4_950,
      freeShippingThresholdAmount: 100_000,
      lowStockThreshold: 5,
    });
    const [audit] = await db.auditLog.findMany({
      where: { action: SETTINGS_AUDIT_ACTIONS.updated },
    });
    expect(audit).toMatchObject({
      adminUserId: owner.id,
      entityType: "StoreSettings",
      entityId: "1",
      metadata: {
        created: false,
        changes: {
          shippingPriceAmount: { from: 7_900, to: 4_950 },
          freeShippingThresholdAmount: { from: 150_000, to: 100_000 },
          lowStockThreshold: { from: 3, to: 5 },
          contactEmail: {
            from: "kundservice@heavycards.se",
            to: "hej@heavycards.se",
          },
        },
      },
    });
  });

  it("refreshes nothing for checkout-only changes and the homepage for SEO texts", async () => {
    expect(
      await updateStoreSettings(db, {
        actorId: owner.id,
        input: formValues({
          companyName: "",
          organizationNumber: "",
          shippingPrice: "99",
        }),
      }),
    ).toMatchObject({
      ok: true,
      changed: ["shippingPriceAmount"],
      revalidate: [],
    });
    expect(
      await updateStoreSettings(db, {
        actorId: owner.id,
        input: formValues({
          companyName: "",
          organizationNumber: "",
          shippingPrice: "99",
          defaultSeoTitle: "HeavyCards – Pokémon TCG",
        }),
      }),
    ).toMatchObject({ ok: true, revalidate: [{ path: "/" }] });
  });

  it("refuses ADMIN and inactive OWNER accounts and writes nothing", async () => {
    const inactiveOwner = await createAdmin(db, {
      role: "OWNER",
      isActive: false,
    });
    for (const actorId of [admin.id, inactiveOwner.id]) {
      await expect(
        updateStoreSettings(db, {
          actorId,
          input: formValues({ shippingPrice: "1" }),
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(
      await db.storeSettings.findUniqueOrThrow({ where: { id: 1 } }),
    ).toMatchObject({ shippingPriceAmount: 7_900 });
    expect(await db.auditLog.count()).toBe(0);

    // Reading is open to every active administrator.
    expect(
      await getStoreSettingsForAdmin(db, { actorId: admin.id }),
    ).toMatchObject({ shippingPriceAmount: 7_900 });
    await expect(
      getStoreSettingsForAdmin(db, { actorId: inactiveOwner.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("validates on the server and saves nothing invalid", async () => {
    const result = await updateStoreSettings(db, {
      actorId: owner.id,
      input: formValues({
        shippingPrice: "79.999",
        freeShippingThreshold: "0",
        contactEmail: "inte-en-adress",
        organizationNumber: "556677-8890",
        vatRate: "2000",
        lowStockThreshold: "-1",
      }),
    });
    expect(result).toMatchObject({
      ok: false,
      error: "INVALID_INPUT",
      fieldErrors: {
        shippingPrice: expect.any(String),
        contactEmail: expect.any(String),
        organizationNumber: expect.any(String),
        vatRate: expect.any(String),
        lowStockThreshold: expect.any(String),
      },
    });
    // A tampered request with numbers instead of form strings is refused too.
    expect(
      await updateStoreSettings(db, {
        actorId: owner.id,
        input: { ...formValues(), shippingPrice: 7_900 },
      }),
    ).toMatchObject({ ok: false, error: "INVALID_INPUT" });
    expect(
      await db.storeSettings.findUniqueOrThrow({ where: { id: 1 } }),
    ).toMatchObject(SETTINGS);
    expect(await db.auditLog.count()).toBe(0);
  });

  it("an unchanged save writes no audit entry, and concurrent identical saves write one", async () => {
    const first = await Promise.all(
      [owner.id, owner.id, owner.id].map((actorId) =>
        updateStoreSettings(db, {
          actorId,
          input: formValues({ shippingPrice: "59" }),
        }),
      ),
    );
    expect(first.every((result) => result.ok)).toBe(true);
    expect(
      await db.auditLog.count({
        where: { action: SETTINGS_AUDIT_ACTIONS.updated },
      }),
    ).toBe(1);
    expect(
      await updateStoreSettings(db, {
        actorId: owner.id,
        input: formValues({ shippingPrice: "59" }),
      }),
    ).toMatchObject({ ok: true, changed: [], revalidate: [] });
    expect(await db.auditLog.count()).toBe(1);
  });

  it("new shipping price, free-shipping threshold and VAT rate apply to the next checkout only", async () => {
    const before = await checkoutShipping(50_000);
    expect(before).toMatchObject({ shippingAmount: 7_900 });

    await updateStoreSettings(db, {
      actorId: owner.id,
      input: formValues({
        shippingPrice: "49",
        freeShippingThreshold: "400",
        vatRate: "1200",
      }),
    });

    const cheap = await checkoutShipping(30_000);
    const free = await checkoutShipping(40_000);
    expect(cheap).toMatchObject({ shippingAmount: 4_900, totalAmount: 34_900 });
    expect(cheap.items[0]!.vatRateBasisPoints).toBe(1_200);
    expect(free).toMatchObject({ shippingAmount: 0 });
    // The earlier order keeps its own shipping and VAT.
    expect(
      await db.order.findUniqueOrThrow({
        where: { id: before.id },
        include: { items: true },
      }),
    ).toMatchObject({
      shippingAmount: 7_900,
      items: [{ vatRateBasisPoints: 2_500 }],
    });
  });

  it("an empty free-shipping threshold turns free shipping off", async () => {
    await updateStoreSettings(db, {
      actorId: owner.id,
      input: formValues({ freeShippingThreshold: "" }),
    });
    expect(
      await db.storeSettings.findUniqueOrThrow({ where: { id: 1 } }),
    ).toMatchObject({ freeShippingThresholdAmount: null });
    expect(await checkoutShipping(900_000)).toMatchObject({
      shippingAmount: 7_900,
    });
  });

  it("a new low-stock threshold changes which products count as low", async () => {
    const product = await createProduct(db, {
      stockOnHand: 4,
      publishedAt: new Date(Date.now() - DAY_MS),
    });
    const low = async () => {
      const settings = await getStoreSettingsForAdmin(db, {
        actorId: admin.id,
      });
      return listAdminProducts(db, {
        params: {
          q: "",
          status: "publicerade",
          categoryId: "",
          setId: "",
          stock: "lagt",
          sort: "lager",
          page: 1,
        },
        lowStockThreshold: settings!.lowStockThreshold,
        now: new Date(),
      });
    };
    expect((await low()).total).toBe(0);
    await updateStoreSettings(db, {
      actorId: owner.id,
      input: formValues({ lowStockThreshold: "4" }),
    });
    expect((await low()).rows.map((row) => row.id)).toEqual([product.id]);
  });
});

describe("store settings on a fresh store", () => {
  it("creates the settings row on the first save, which opens checkout", async () => {
    const product = await createProduct(db, {
      priceAmount: 10_000,
      publishedAt: new Date(Date.now() - DAY_MS),
    });
    const attempt = () =>
      createCheckout(
        {
          db,
          gateway: new FakeCheckoutGateway(),
          siteUrl: "http://localhost:3100",
        },
        {
          attemptId: randomUUID(),
          lines: [
            {
              productId: product.id,
              quantity: 1,
              expectedUnitPriceAmount: 10_000,
            },
          ],
        },
      );
    expect(await attempt()).toMatchObject({
      ok: false,
      code: "payment_unavailable",
    });
    expect(
      await getStoreSettingsForAdmin(db, { actorId: owner.id }),
    ).toBeNull();

    const created = await updateStoreSettings(db, {
      actorId: owner.id,
      input: formValues(),
    });
    expect(created).toMatchObject({
      ok: true,
      created: true,
      revalidate: [{ path: "/", type: "layout" }],
    });
    expect(
      await db.auditLog.findFirstOrThrow({
        where: { action: SETTINGS_AUDIT_ACTIONS.updated },
      }),
    ).toMatchObject({ metadata: { created: true } });
    expect(await attempt()).toMatchObject({ ok: true });
  });
});
