import { describe, expect, it } from "vitest";

import { InvalidAmountError } from "@/lib/money";
import { calculateShippingAmount } from "@/server/domain/shipping";

const settings = {
  shippingPriceAmount: 7_900,
  freeShippingThresholdAmount: 150_000,
};

describe("calculateShippingAmount", () => {
  it("charges the flat rate below the free-shipping threshold", () => {
    expect(calculateShippingAmount(149_999, settings)).toBe(7_900);
  });

  it("is free at exactly the threshold and above", () => {
    expect(calculateShippingAmount(150_000, settings)).toBe(0);
    expect(calculateShippingAmount(219_900, settings)).toBe(0);
  });

  it("always charges when free shipping is disabled", () => {
    expect(
      calculateShippingAmount(10_000_000, {
        ...settings,
        freeShippingThresholdAmount: null,
      }),
    ).toBe(7_900);
  });

  it("supports free shipping for everything with a zero threshold", () => {
    expect(
      calculateShippingAmount(0, {
        ...settings,
        freeShippingThresholdAmount: 0,
      }),
    ).toBe(0);
  });

  it("rejects invalid amounts", () => {
    expect(() => calculateShippingAmount(-1, settings)).toThrow(
      InvalidAmountError,
    );
    expect(() =>
      calculateShippingAmount(100, { ...settings, shippingPriceAmount: 79.5 }),
    ).toThrow(InvalidAmountError);
  });
});
