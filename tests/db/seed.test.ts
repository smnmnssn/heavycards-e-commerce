import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { availableToSell } from "@/server/domain/inventory";

import { seedDatabase } from "../../prisma/seed/seed-database";
import { createTestDb, resetDatabase } from "./test-database";

const db = createTestDb();
const now = new Date();

beforeAll(async () => {
  await resetDatabase(db);
});
afterAll(() => db.$disconnect());

describe("development seed", () => {
  it("is idempotent", async () => {
    const first = await seedDatabase(db, now);
    const second = await seedDatabase(db, now);

    expect(second).toEqual(first);
    expect(first).toEqual({
      categories: 6,
      pokemonSets: 7,
      products: 12,
      orders: 5,
      reviews: 4,
      adminUsers: 2,
    });
    expect(await db.auditLog.count()).toBe(2);
  });

  it("creates a development OWNER without credentials", async () => {
    const owners = await db.adminUser.findMany({ where: { role: "OWNER" } });

    expect(owners).toHaveLength(1);
    expect(owners[0]).toMatchObject({ isActive: true, passwordHash: null });
  });

  it("covers the catalog states later milestones need", async () => {
    const products = await db.product.findMany({
      include: { reservations: true },
    });
    const bySku = new Map(products.map((p) => [p.sku, p]));

    // Sold out is derived: ACTIVE with nothing available.
    const soldOut = bySku.get("SV8PT5-ETB-EN")!;
    expect(soldOut.status).toBe("ACTIVE");
    expect(
      availableToSell(soldOut.stockOnHand, soldOut.reservations, now),
    ).toBe(0);

    // A pending checkout reservation reduces availability.
    const reserved = bySku.get("SV10-BB-EN")!;
    expect(
      availableToSell(reserved.stockOnHand, reserved.reservations, now),
    ).toBe(reserved.stockOnHand - 1);

    expect(bySku.get("UPCOMING-BB-EN")).toMatchObject({
      status: "COMING_SOON",
      isPreorder: false,
    });
    expect(bySku.get("UPCOMING-ETB-EN")).toMatchObject({
      status: "COMING_SOON",
      isPreorder: true,
    });
    expect(bySku.get("ME01-BB-EN")).toMatchObject({
      status: "DRAFT",
      publishedAt: null,
    });
    expect(bySku.get("SV3PT5-BNDL-EN")?.status).toBe("ARCHIVED");
    expect(
      products.filter((p) => p.stockOnHand > 0 && p.stockOnHand <= 3).length,
    ).toBeGreaterThan(0);
  });

  it("creates orders in every relevant payment state with consistent totals", async () => {
    const orders = await db.order.findMany({ include: { items: true } });

    expect(new Set(orders.map((o) => o.paymentStatus))).toEqual(
      new Set(["PAID", "PARTIALLY_REFUNDED", "PENDING", "EXPIRED"]),
    );
    for (const order of orders) {
      const itemsTotal = order.items.reduce(
        (s, i) => s + i.totalPriceAmount,
        0,
      );
      expect(order.subtotalAmount).toBe(itemsTotal);
    }
  });

  it("creates approved, pending and rejected verified reviews", async () => {
    const reviews = await db.review.findMany();

    expect(reviews.every((r) => r.verifiedPurchase && r.orderItemId)).toBe(
      true,
    );
    expect(new Set(reviews.map((r) => r.status))).toEqual(
      new Set(["APPROVED", "PENDING", "REJECTED"]),
    );
  });
});
