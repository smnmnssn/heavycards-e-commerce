import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  addToCart,
  emptyCart,
  findConflict,
  lineQuantity,
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  parseStoredCart,
  removeFromCart,
  serializeCart,
  setLineQuantity,
  shipmentConflict,
  totalQuantity,
  type Cart,
  type ShipmentGroup,
} from "@/lib/cart/cart";
import { evaluateCart, type CartProductView } from "@/lib/cart/evaluate";

const A = "01999999-0000-7000-8000-00000000000a";
const B = "01999999-0000-7000-8000-00000000000b";
const C = "01999999-0000-7000-8000-00000000000c";

const cartOf = (...lines: Array<[string, number]>): Cart => ({
  lines: lines.map(([productId, quantity]) => ({ productId, quantity })),
});

describe("cart operations", () => {
  it("adds a new line and increments an existing one", () => {
    const first = addToCart(emptyCart, A, 1, 10);
    const second = addToCart(first.cart, A, 2, 10);

    expect(first.added).toBe(1);
    expect(second.added).toBe(2);
    expect(second.cart).toEqual(cartOf([A, 3]));
  });

  it("clamps additions to the maximum and reports what was added", () => {
    const { cart, added } = addToCart(cartOf([A, 4]), A, 5, 6);

    expect(added).toBe(2);
    expect(lineQuantity(cart, A)).toBe(6);
    expect(addToCart(cart, A, 1, 6)).toEqual({ cart, added: 0 });
  });

  it("never exceeds the technical line ceiling", () => {
    expect(lineQuantity(addToCart(emptyCart, A, 500, 1000).cart, A)).toBe(
      MAX_LINE_QUANTITY,
    );
  });

  it.each([0, -1, 1.5, Number.NaN])(
    "ignores invalid quantity %d",
    (quantity) => {
      expect(addToCart(emptyCart, A, quantity, 10)).toEqual({
        cart: emptyCart,
        added: 0,
      });
    },
  );

  it("refuses new lines beyond the line limit", () => {
    let cart: Cart = emptyCart;
    for (let index = 0; index < MAX_CART_LINES; index += 1) {
      const id = `01999999-0000-7000-8000-${String(index).padStart(12, "0")}`;
      cart = addToCart(cart, id, 1, 10).cart;
    }
    expect(addToCart(cart, A, 1, 10).added).toBe(0);
  });

  it("sets, decrements and removes quantities", () => {
    const cart = cartOf([A, 3], [B, 1]);

    expect(setLineQuantity(cart, A, 2)).toEqual(cartOf([A, 2], [B, 1]));
    expect(setLineQuantity(cart, A, 0)).toEqual(cartOf([B, 1]));
    expect(setLineQuantity(cart, A, 9, 5)).toEqual(cartOf([A, 5], [B, 1]));
    expect(removeFromCart(cart, B)).toEqual(cartOf([A, 3]));
  });

  it("counts total units, not lines (PROJECT.md §20)", () => {
    expect(totalQuantity(cartOf([A, 2], [B, 1]))).toBe(3);
    expect(totalQuantity(emptyCart)).toBe(0);
  });
});

describe("persistence", () => {
  it("round-trips through the versioned format with IDs and quantities only", () => {
    const cart = cartOf([A, 2], [B, 1]);
    const stored = serializeCart(cart);

    expect(JSON.parse(stored)).toEqual({
      v: 1,
      lines: [
        { id: A, q: 2 },
        { id: B, q: 1 },
      ],
    });
    expect(parseStoredCart(stored)).toEqual(cart);
  });

  it.each([
    null,
    "",
    "not json",
    "{",
    "null",
    "[]",
    '{"v":2,"lines":[]}',
    '{"lines":[]}',
    '{"v":1,"lines":"x"}',
  ])("recovers an empty cart from %j", (raw) => {
    expect(parseStoredCart(raw)).toEqual(emptyCart);
  });

  it("drops invalid lines, merges duplicates and clamps quantities", () => {
    const raw = JSON.stringify({
      v: 1,
      lines: [
        { id: A, q: 2 },
        { id: "not-a-uuid", q: 1 },
        { id: B, q: 0 },
        { id: B, q: 1.5 },
        { id: C, q: "3" },
        { id: A, q: 3 },
        { id: B, q: 1000 },
        "garbage",
        null,
      ],
    });

    expect(parseStoredCart(raw)).toEqual(
      cartOf([A, 5], [B, MAX_LINE_QUANTITY]),
    );
  });

  it("ignores stored prices or other fields", () => {
    const raw = JSON.stringify({
      v: 1,
      lines: [{ id: A, q: 1, price: 1, name: "Fake" }],
      total: 1,
    });

    expect(parseStoredCart(raw)).toEqual(cartOf([A, 1]));
  });
});

describe("one-shipment rules (V1)", () => {
  const stock: ShipmentGroup = { kind: "stock" };
  const preorder = (releaseDate: string | null): ShipmentGroup => ({
    kind: "preorder",
    releaseDate,
  });

  it("allows in-stock products together", () => {
    expect(
      shipmentConflict(
        { productId: A, shipment: stock },
        { productId: B, shipment: stock },
      ),
    ).toBeNull();
  });

  it("rejects mixing preorder and in-stock products, in both directions", () => {
    expect(
      findConflict([{ productId: A, shipment: stock }], {
        productId: B,
        shipment: preorder("2026-11-14"),
      }),
    ).toBe("preorder_with_stock");
    expect(
      findConflict([{ productId: A, shipment: preorder("2026-11-14") }], {
        productId: B,
        shipment: stock,
      }),
    ).toBe("preorder_with_stock");
  });

  it("allows preorders with the same release date only", () => {
    expect(
      findConflict([{ productId: A, shipment: preorder("2026-11-14") }], {
        productId: B,
        shipment: preorder("2026-11-14"),
      }),
    ).toBeNull();
    expect(
      findConflict([{ productId: A, shipment: preorder("2026-11-14") }], {
        productId: B,
        shipment: preorder("2026-12-14"),
      }),
    ).toBe("different_release_dates");
  });

  it("treats preorders without a release date as not combinable", () => {
    expect(
      findConflict([{ productId: A, shipment: preorder(null) }], {
        productId: B,
        shipment: preorder(null),
      }),
    ).toBe("different_release_dates");
  });

  it("never conflicts with itself (adding more of the same product)", () => {
    expect(
      findConflict([{ productId: A, shipment: preorder(null) }], {
        productId: A,
        shipment: preorder(null),
      }),
    ).toBeNull();
  });
});

describe("evaluateCart", () => {
  const view = (overrides: Partial<CartProductView>): CartProductView => ({
    productId: A,
    available: true,
    unavailableReason: null,
    name: "Produkt",
    slug: "produkt",
    setName: null,
    image: null,
    unitPriceAmount: 10_000,
    maxQuantity: 10,
    shipment: { kind: "stock" },
    ...overrides,
  });

  it("computes line totals and a display subtotal from server prices", () => {
    const result = evaluateCart(cartOf([A, 2], [B, 1]), {
      [A]: view({ productId: A, unitPriceAmount: 219_900 }),
      [B]: view({ productId: B, unitPriceAmount: 69_900 }),
    });

    expect(result.lines.map((line) => line.lineTotalAmount)).toEqual([
      439_800, 69_900,
    ]);
    expect(result.subtotalAmount).toBe(509_700);
    expect(result).toMatchObject({
      incomplete: false,
      hasIssues: false,
      conflict: null,
    });
  });

  it("flags unavailable lines and leaves them out of the subtotal", () => {
    const result = evaluateCart(cartOf([A, 1], [B, 2]), {
      [A]: view({ productId: A }),
      [B]: view({
        productId: B,
        available: false,
        unavailableReason: "sold_out",
        maxQuantity: 0,
      }),
    });

    expect(result.lines[1]?.issue).toBe("unavailable");
    expect(result.subtotalAmount).toBe(10_000);
    expect(result.hasIssues).toBe(true);
  });

  it("flags quantities above current availability", () => {
    const result = evaluateCart(cartOf([A, 5]), {
      [A]: view({ maxQuantity: 2 }),
    });

    expect(result.lines[0]?.issue).toBe("exceeds_available");
  });

  it("reports missing server data as incomplete", () => {
    const result = evaluateCart(cartOf([A, 1]), {});

    expect(result.incomplete).toBe(true);
    expect(result.subtotalAmount).toBe(0);
  });

  it("detects conflicts in a persisted cart, ignoring unavailable products", () => {
    const mixed = evaluateCart(cartOf([A, 1], [B, 1]), {
      [A]: view({ productId: A }),
      [B]: view({
        productId: B,
        shipment: { kind: "preorder", releaseDate: "2026-11-14" },
      }),
    });
    expect(mixed.conflict).toBe("preorder_with_stock");

    const withUnavailable = evaluateCart(cartOf([A, 1], [B, 1]), {
      [A]: view({ productId: A }),
      [B]: view({
        productId: B,
        available: false,
        unavailableReason: "coming_soon",
        shipment: { kind: "preorder", releaseDate: "2026-11-14" },
      }),
    });
    expect(withUnavailable.conflict).toBeNull();
  });
});

describe("stored cart parsing without Zod (Milestone 14)", () => {
  const stored = (lines: unknown, v: unknown = 1) =>
    JSON.stringify({ v, lines });

  it("accepts exactly the product IDs the server's z.uuid() accepts", () => {
    const candidates = [
      "01999999-0000-7000-8000-00000000000a",
      "01999999-0000-7000-8000-00000000000A",
      "01999999-0000-0000-8000-00000000000a", // version 0
      "01999999-0000-7000-c000-00000000000a", // wrong variant
      "00000000-0000-0000-0000-000000000000",
      "ffffffff-ffff-ffff-ffff-ffffffffffff",
      "not-a-uuid",
      " 01999999-0000-7000-8000-00000000000a",
    ];
    for (const id of candidates) {
      const kept = parseStoredCart(stored([{ id, q: 1 }])).lines.length === 1;
      expect(kept, id).toBe(z.uuid().safeParse(id).success);
    }
  });

  it.each([
    ["an array instead of an object", "[]"],
    ["a wrong version", stored([], 2)],
    ["lines that are not a list", JSON.stringify({ v: 1, lines: {} })],
    [
      "more than 500 stored lines",
      stored(Array.from({ length: 501 }, () => ({ id: "x", q: 1 }))),
    ],
  ])("returns an empty cart for %s", (_label, raw) => {
    expect(parseStoredCart(raw)).toEqual(emptyCart);
  });

  it.each([
    [{ id: "01999999-0000-7000-8000-00000000000a", q: 1.5 }],
    [{ id: "01999999-0000-7000-8000-00000000000a", q: 0 }],
    [{ id: "01999999-0000-7000-8000-00000000000a", q: "2" }],
    [{ id: "01999999-0000-7000-8000-00000000000a", q: 2 ** 60 }],
    [["01999999-0000-7000-8000-00000000000a", 1]],
    [null],
  ])("drops the invalid line %j", (line) => {
    expect(parseStoredCart(stored([line])).lines).toEqual([]);
  });
});
