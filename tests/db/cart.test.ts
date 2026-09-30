import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadCartProducts } from "@/server/cart/cart-products";

import { seedDatabase } from "../../prisma/seed/seed-database";
import { createTestDb, resetDatabase } from "./test-database";

const db = createTestDb();
const now = new Date();

const idOf = async (sku: string) =>
  (await db.product.findUniqueOrThrow({ where: { sku }, select: { id: true } }))
    .id;

beforeAll(async () => {
  await resetDatabase(db);
  await seedDatabase(db, now);
});
afterAll(() => db.$disconnect());

describe("loadCartProducts", () => {
  it("returns current price, limit and shipment for purchasable products", async () => {
    const id = await idOf("SV10-BB-EN");
    const [view] = await loadCartProducts(db, [id], now);

    expect(view).toMatchObject({
      productId: id,
      available: true,
      unavailableReason: null,
      name: "Destined Rivals Booster Box",
      slug: "destined-rivals-booster-box",
      setName: "Destined Rivals",
      unitPriceAmount: 219_900,
      // 12 in stock, 1 held by the seeded pending checkout.
      maxQuantity: 11,
      shipment: { kind: "stock" },
    });
  });

  it("marks unavailable products with a reason and no quantity", async () => {
    const views = await loadCartProducts(
      db,
      [
        await idOf("SV8PT5-ETB-EN"), // sold out
        await idOf("UPCOMING-BB-EN"), // coming soon, no preorder
        await idOf("SV3PT5-BNDL-EN"), // archived
      ],
      now,
    );

    expect(
      views.map((v) => [v.available, v.unavailableReason, v.maxQuantity]),
    ).toEqual([
      [false, "sold_out", 0],
      [false, "coming_soon", 0],
      [false, "discontinued", 0],
    ]);
  });

  it("reveals nothing about drafts or unknown IDs", async () => {
    const draft = await idOf("ME01-BB-EN");
    const unknown = "01999999-0000-7000-8000-000000000000";
    const views = await loadCartProducts(db, [draft, unknown], now);

    for (const view of views) {
      expect(view).toMatchObject({
        available: false,
        unavailableReason: "not_found",
        name: null,
        slug: null,
        unitPriceAmount: null,
      });
    }
  });

  it("groups preorders by release date for the one-shipment rule", async () => {
    const [etb, bundle] = await loadCartProducts(
      db,
      [await idOf("UPCOMING-ETB-EN"), await idOf("UPCOMING-BNDL-EN")],
      now,
    );

    expect(etb?.shipment?.kind).toBe("preorder");
    expect(bundle?.shipment?.kind).toBe("preorder");
    expect(etb?.available && bundle?.available).toBe(true);
    expect(
      etb?.shipment?.kind === "preorder" &&
        bundle?.shipment?.kind === "preorder"
        ? etb.shipment.releaseDate !== bundle.shipment.releaseDate
        : false,
    ).toBe(true);
  });

  it("keeps a product a preorder after its release date has passed", async () => {
    const id = await idOf("UPCOMING-ETB-EN");
    await db.product.update({
      where: { id },
      data: { releaseDate: new Date("2020-01-01T00:00:00Z") },
    });

    const [view] = await loadCartProducts(db, [id], now);

    expect(view?.shipment).toEqual({
      kind: "preorder",
      releaseDate: "2020-01-01",
    });
    expect(view?.available).toBe(true);
  });

  it("preserves the requested order", async () => {
    const ids = [await idOf("SV10-BP-EN"), await idOf("SV10-BB-EN")];

    expect(
      (await loadCartProducts(db, ids, now)).map((v) => v.productId),
    ).toEqual(ids);
  });
});
