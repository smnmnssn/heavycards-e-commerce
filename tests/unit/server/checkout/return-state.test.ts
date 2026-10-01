import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  checkoutReturnState,
  parseCheckoutSessionId,
} from "@/server/checkout/return-state";

describe("parseCheckoutSessionId", () => {
  it.each([
    ["cs_test_a1B2c3", "cs_test_a1B2c3"],
    ["cs_live_a1B2c3", "cs_live_a1B2c3"],
    ["{CHECKOUT_SESSION_ID}", null],
    ["cs_test_", null],
    ["pi_test_abc", null],
    ["cs_test_abc' OR 1=1", null],
    [["cs_test_a", "cs_test_b"], null],
    [undefined, null],
  ])("%j → %j", (value, expected) => {
    expect(parseCheckoutSessionId(value)).toBe(expected);
  });
});

describe("checkoutReturnState", () => {
  const ATTEMPT = "6f1c1f9e-3b7a-4c2e-9a51-1e0f2d3c4b5a";
  const order = (
    paymentStatus: Parameters<typeof checkoutReturnState>[0] extends infer O
      ? O extends { paymentStatus: infer S }
        ? S
        : never
      : never,
  ) => ({
    orderNumber: 10_001,
    paymentStatus,
    totalAmount: 77_800,
    checkoutAttemptId: ATTEMPT,
    items: [
      {
        productId: "01999999-0000-7000-8000-00000000000a",
        productNameSnapshot: "Booster Box",
        quantity: 2,
      },
    ],
  });

  it("never claims payment for a pending order", () => {
    expect(checkoutReturnState(order("PENDING"))).toEqual({
      kind: "processing",
      orderNumber: "HC-10001",
    });
  });

  it("shows products and total (no personal data) once paid", () => {
    const state = checkoutReturnState(order("PAID"));
    expect(state).toEqual({
      kind: "paid",
      orderNumber: "HC-10001",
      totalAmount: 77_800,
      lines: [
        {
          productId: "01999999-0000-7000-8000-00000000000a",
          name: "Booster Box",
          quantity: 2,
        },
      ],
      attemptHash: createHash("sha256").update(ATTEMPT).digest("hex"),
    });
    expect(JSON.stringify(state)).not.toContain(ATTEMPT);
    expect(checkoutReturnState(order("PARTIALLY_REFUNDED")).kind).toBe("paid");
  });

  it("distinguishes refunded, expired and failed orders", () => {
    expect(checkoutReturnState(order("REFUNDED")).kind).toBe("refunded");
    expect(checkoutReturnState(order("EXPIRED")).kind).toBe("expired");
    expect(checkoutReturnState(order("FAILED")).kind).toBe("failed");
    expect(checkoutReturnState(null)).toEqual({ kind: "unknown" });
  });

  it("has no attempt hash for orders without a checkout attempt", () => {
    expect(
      checkoutReturnState({ ...order("PAID"), checkoutAttemptId: null }),
    ).toMatchObject({ attemptHash: null });
  });
});
