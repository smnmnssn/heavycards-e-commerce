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
  it("never claims payment for a pending order", () => {
    expect(
      checkoutReturnState({ orderNumber: 10_001, paymentStatus: "PENDING" }),
    ).toEqual({ kind: "processing", orderNumber: "HC-10001" });
  });

  it("reflects only database payment states", () => {
    expect(
      checkoutReturnState({ orderNumber: 10_002, paymentStatus: "PAID" }),
    ).toEqual({ kind: "paid", orderNumber: "HC-10002" });
    expect(
      checkoutReturnState({ orderNumber: 10_003, paymentStatus: "REFUNDED" })
        .kind,
    ).toBe("refunded");
    expect(
      checkoutReturnState({ orderNumber: 10_004, paymentStatus: "EXPIRED" })
        .kind,
    ).toBe("not_completed");
    expect(
      checkoutReturnState({ orderNumber: 10_005, paymentStatus: "FAILED" })
        .kind,
    ).toBe("not_completed");
    expect(checkoutReturnState(null)).toEqual({ kind: "unknown" });
  });
});
