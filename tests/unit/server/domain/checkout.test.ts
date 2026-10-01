import { describe, expect, it } from "vitest";

import type { CartProductView } from "@/lib/cart/evaluate";
import type { CheckoutLineRequest } from "@/lib/checkout/checkout";
import {
  CHECKOUT_SESSION_TTL_MS,
  evaluateCheckout,
  matchesOrderLines,
  PROVISIONAL_HOLD_MS,
  priceCheckout,
  provisionalHoldUntil,
  RESERVATION_GRACE_MS,
  reservationHoldUntil,
  sessionExpiryFor,
  type CheckoutProduct,
} from "@/server/domain/checkout";

const A = "01999999-0000-7000-8000-00000000000a";
const B = "01999999-0000-7000-8000-00000000000b";

const settings = {
  shippingPriceAmount: 7_900,
  freeShippingThresholdAmount: 150_000,
  vatRateBasisPoints: 2_500,
};

function product(
  productId: string,
  overrides: Partial<CartProductView> = {},
  sku: string | null = `SKU-${productId.slice(-1)}`,
): CheckoutProduct {
  return {
    sku,
    view: {
      productId,
      available: true,
      unavailableReason: null,
      name: `Produkt ${productId.slice(-1)}`,
      slug: "produkt",
      setName: null,
      image: null,
      unitPriceAmount: 10_000,
      maxQuantity: 10,
      shipment: { kind: "stock" },
      ...overrides,
    },
  };
}

const line = (
  productId: string,
  quantity = 1,
  expectedUnitPriceAmount = 10_000,
): CheckoutLineRequest => ({ productId, quantity, expectedUnitPriceAmount });

const catalog = (...products: CheckoutProduct[]) =>
  new Map(products.map((p) => [p.view.productId, p]));

describe("evaluateCheckout", () => {
  it("prices lines from product data only", () => {
    const result = evaluateCheckout(
      [line(A, 2, 10_000), line(B, 1, 5_000)],
      catalog(product(A), product(B, { unitPriceAmount: 5_000 })),
      settings,
    );

    expect(result).toEqual({
      ok: true,
      checkout: {
        lines: [
          {
            productId: A,
            name: "Produkt a",
            sku: "SKU-a",
            quantity: 2,
            unitPriceAmount: 10_000,
            totalPriceAmount: 20_000,
          },
          {
            productId: B,
            name: "Produkt b",
            sku: "SKU-b",
            quantity: 1,
            unitPriceAmount: 5_000,
            totalPriceAmount: 5_000,
          },
        ],
        subtotalAmount: 25_000,
        shippingAmount: 7_900,
        totalAmount: 32_900,
        taxAmount: 6_580,
        vatRateBasisPoints: 2_500,
      },
    });
  });

  it("refuses a displayed price that differs from the current one, both lower and higher", () => {
    for (const expected of [1, 10_001]) {
      expect(
        evaluateCheckout([line(A, 1, expected)], catalog(product(A)), settings),
      ).toEqual({
        ok: false,
        issues: [
          {
            productId: A,
            kind: "price_changed",
            unitPriceAmount: 10_000,
            expectedUnitPriceAmount: expected,
          },
        ],
        conflict: null,
      });
    }
  });

  it("reports unavailable products with their reason, and unknown ones as not found", () => {
    const result = evaluateCheckout(
      [line(A), line(B)],
      catalog(
        product(A, {
          available: false,
          unavailableReason: "discontinued",
          maxQuantity: 0,
        }),
      ),
      settings,
    );

    expect(result).toEqual({
      ok: false,
      issues: [
        { productId: A, kind: "unavailable", reason: "discontinued" },
        { productId: B, kind: "unavailable", reason: "not_found" },
      ],
      conflict: null,
    });
  });

  it("reports quantities above available-to-sell", () => {
    expect(
      evaluateCheckout(
        [line(A, 3)],
        catalog(product(A, { maxQuantity: 2 })),
        settings,
      ),
    ).toMatchObject({
      ok: false,
      issues: [{ kind: "insufficient_quantity", availableQuantity: 2 }],
    });
  });

  it("refuses products that cannot ship together", () => {
    const preorder = product(B, {
      shipment: { kind: "preorder", releaseDate: "2026-12-01" },
    });
    expect(
      evaluateCheckout(
        [line(A), line(B)],
        catalog(product(A), preorder),
        settings,
      ),
    ).toEqual({ ok: false, issues: [], conflict: "preorder_with_stock" });

    const otherDate = product(A, {
      shipment: { kind: "preorder", releaseDate: "2026-11-01" },
    });
    expect(
      evaluateCheckout(
        [line(A), line(B)],
        catalog(otherDate, preorder),
        settings,
      ),
    ).toMatchObject({ conflict: "different_release_dates" });
  });
});

describe("priceCheckout", () => {
  const priced = (unit: number) =>
    priceCheckout(
      [
        {
          productId: A,
          name: "A",
          sku: "A",
          quantity: 1,
          unitPriceAmount: unit,
          totalPriceAmount: unit,
        },
      ],
      settings,
    );

  it("adds flat shipping below the threshold and none at or above it", () => {
    expect(priced(149_999)).toMatchObject({
      shippingAmount: 7_900,
      totalAmount: 157_899,
    });
    expect(priced(150_000)).toMatchObject({
      shippingAmount: 0,
      totalAmount: 150_000,
    });
  });

  it("reports the VAT contained in the total, including shipping", () => {
    // 100 kr + 79 kr shipping = 179 kr; 25 % VAT inside = 35,80 kr.
    expect(priced(10_000).taxAmount).toBe(3_580);
  });

  it("uses the configured VAT rate", () => {
    const result = priceCheckout(
      [
        {
          productId: A,
          name: "A",
          sku: "A",
          quantity: 1,
          unitPriceAmount: 10_600,
          totalPriceAmount: 10_600,
        },
      ],
      { ...settings, freeShippingThresholdAmount: 0, vatRateBasisPoints: 600 },
    );
    expect(result).toMatchObject({ taxAmount: 600, vatRateBasisPoints: 600 });
  });
});

describe("reservation timing", () => {
  const now = new Date("2026-10-01T12:00:00.750Z");

  it("uses a Stripe-valid session lifetime in whole seconds", () => {
    const expiry = sessionExpiryFor(now);
    expect(expiry.getTime() % 1000).toBe(0);
    const lifetime = expiry.getTime() - now.getTime();
    // Stripe: 30 minutes to 24 hours, even when created a provisional hold
    // later.
    expect(lifetime - PROVISIONAL_HOLD_MS).toBeGreaterThan(30 * 60_000);
    expect(lifetime).toBeLessThanOrEqual(CHECKOUT_SESSION_TTL_MS);
    expect(lifetime).toBeLessThan(24 * 60 * 60_000);
  });

  it("holds briefly before the session exists and past its expiry afterwards", () => {
    expect(provisionalHoldUntil(now).getTime() - now.getTime()).toBe(
      PROVISIONAL_HOLD_MS,
    );
    const sessionExpiry = sessionExpiryFor(now);
    expect(reservationHoldUntil(sessionExpiry).getTime()).toBe(
      sessionExpiry.getTime() + RESERVATION_GRACE_MS,
    );
    expect(RESERVATION_GRACE_MS).toBeGreaterThan(0);
  });
});

describe("matchesOrderLines", () => {
  const items = [
    { productId: A, quantity: 2, unitPriceAmount: 10_000 },
    { productId: B, quantity: 1, unitPriceAmount: 5_000 },
  ];

  it("matches the same lines in any order", () => {
    expect(
      matchesOrderLines(items, [line(B, 1, 5_000), line(A, 2, 10_000)]),
    ).toBe(true);
  });

  it.each([
    ["a different quantity", [line(A, 1, 10_000), line(B, 1, 5_000)]],
    ["a different displayed price", [line(A, 2, 9_000), line(B, 1, 5_000)]],
    ["a missing line", [line(A, 2, 10_000)]],
  ])("rejects %s", (_label, lines) => {
    expect(matchesOrderLines(items, lines)).toBe(false);
  });
});
