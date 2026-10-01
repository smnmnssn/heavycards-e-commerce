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
      products: 13,
      orders: 5,
      reviews: 4,
      adminUsers: 3,
    });
    expect(await db.auditLog.count()).toBe(2);
  });

  it("gives every product exactly one example image, even after reseeding", async () => {
    const products = await db.product.findMany({
      select: { images: { select: { url: true, width: true, height: true } } },
    });

    expect(products.length).toBeGreaterThan(0);
    for (const { images } of products) {
      expect(images).toEqual([
        { url: "/brand/product-example-img.webp", width: 1920, height: 1920 },
      ]);
    }
  });

  it("creates development administrators without credentials by default", async () => {
    const admins = await db.adminUser.findMany({
      select: { email: true, role: true, isActive: true },
      orderBy: { email: "asc" },
    });

    expect(admins).toEqual([
      { email: "admin@heavycards.test", role: "ADMIN", isActive: true },
      { email: "inactive@heavycards.test", role: "ADMIN", isActive: false },
      { email: "owner@heavycards.test", role: "OWNER", isActive: true },
    ]);
    expect(await db.adminAccount.count()).toBe(0);
  });

  it("adds credentials only when given a password hash, without duplicating them", async () => {
    await seedDatabase(db, now, { adminPasswordHash: "hash-1" });
    await seedDatabase(db, now, { adminPasswordHash: "hash-2" });

    const accounts = await db.adminAccount.findMany({
      select: { providerId: true, password: true },
    });
    expect(accounts).toHaveLength(3);
    for (const account of accounts) {
      expect(account).toEqual({ providerId: "credential", password: "hash-2" });
    }

    // Re-running without a password leaves existing credentials untouched.
    await seedDatabase(db, now);
    expect(await db.adminAccount.count({ where: { password: "hash-2" } })).toBe(
      3,
    );
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
