import { describe, expect, it } from "vitest";

import {
  checkoutFailureMessage,
  checkoutRequestSchema,
  isStripeCheckoutUrl,
} from "@/lib/checkout/checkout";
import { formatPrice } from "@/lib/money";

const ID = "01999999-0000-7000-8000-00000000000a";
const ATTEMPT = "6f1c1f9e-3b7a-4c2e-9a51-1e0f2d3c4b5a";

describe("checkoutRequestSchema", () => {
  const valid = {
    attemptId: ATTEMPT,
    lines: [{ productId: ID, quantity: 2, expectedUnitPriceAmount: 69_900 }],
  };

  it("accepts product IDs, quantities, displayed prices and attempt IDs", () => {
    expect(checkoutRequestSchema.parse(valid)).toEqual(valid);
    expect(
      checkoutRequestSchema.safeParse({ ...valid, previousAttemptId: ATTEMPT })
        .success,
    ).toBe(true);
  });

  it.each([
    ["client totals", { ...valid, totalAmount: 1 }],
    ["client shipping", { ...valid, shippingAmount: 0 }],
    [
      "client line totals",
      { ...valid, lines: [{ ...valid.lines[0], totalPriceAmount: 1 }] },
    ],
    [
      "negative prices",
      { ...valid, lines: [{ ...valid.lines[0], expectedUnitPriceAmount: -1 }] },
    ],
    [
      "zero quantities",
      { ...valid, lines: [{ ...valid.lines[0], quantity: 0 }] },
    ],
    [
      "more than 50 lines",
      { ...valid, lines: Array.from({ length: 51 }, () => valid.lines[0]) },
    ],
    ["a missing attempt ID", { lines: valid.lines }],
  ])("refuses %s", (_label, body) => {
    expect(checkoutRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe("isStripeCheckoutUrl", () => {
  it.each([
    ["https://checkout.stripe.com/c/pay/cs_test_abc#frag", true],
    ["http://checkout.stripe.com/c/pay/cs_test_abc", false],
    ["https://checkout.stripe.com.evil.example/c/pay", false],
    ["https://evil.example/?https://checkout.stripe.com", false],
    ["https://user:pw@checkout.stripe.com/c/pay", false],
    ["//checkout.stripe.com/c/pay", false],
    ["javascript:alert(1)", false],
    [42, false],
  ])("%s → %s", (url, expected) => {
    expect(isStripeCheckoutUrl(url)).toBe(expected);
  });
});

describe("checkoutFailureMessage", () => {
  const nameOf = (id: string) => (id === ID ? "Booster Box" : null);

  it("lists each problem with the product name", () => {
    expect(
      checkoutFailureMessage(
        {
          ok: false,
          code: "rejected",
          issues: [
            { productId: ID, kind: "unavailable", reason: "sold_out" },
            {
              productId: "other",
              kind: "insufficient_quantity",
              availableQuantity: 2,
            },
            {
              productId: ID,
              kind: "insufficient_quantity",
              availableQuantity: 0,
            },
            {
              productId: ID,
              kind: "price_changed",
              unitPriceAmount: 179_900,
              expectedUnitPriceAmount: 149_900,
            },
          ],
          conflict: "preorder_with_stock",
        },
        nameOf,
      ),
    ).toEqual({
      title:
        "Kundvagnen har ändrats. Kontrollera den och tryck på Till kassan igen.",
      details: [
        "Booster Box: Produkten är slutsåld och kan inte beställas just nu.",
        "En produkt: Det valda antalet finns inte tillgängligt. Det finns 2 kvar.",
        "Booster Box: Produkten finns inte längre i lager.",
        `Booster Box: Priset har ändrats från ${formatPrice(149_900)} till ${formatPrice(179_900)}.`,
        "Förbeställningar och lagerförda produkter behöver beställas separat. Slutför eller töm din kundvagn först.",
      ],
    });
  });

  it("uses a generic Swedish message for technical failures", () => {
    for (const code of [
      "payment_unavailable",
      "busy",
      "invalid_request",
      "attempt_closed",
    ] as const) {
      expect(checkoutFailureMessage({ ok: false, code }, nameOf)).toEqual({
        title: "Det gick inte att starta betalningen. Försök igen.",
        details: [],
      });
    }
  });
});
