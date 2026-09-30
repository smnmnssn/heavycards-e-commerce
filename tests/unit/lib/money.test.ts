import { describe, expect, it } from "vitest";

import {
  InvalidAmountError,
  MAX_AMOUNT,
  formatSek,
  isValidAmount,
  multiplyAmount,
  sumAmounts,
  vatPortionOfGross,
} from "@/lib/money";

// Intl uses non-breaking spaces as thousands separators in sv-SE.
const normalizeSpaces = (value: string) => value.replace(/\s/g, " ");

describe("isValidAmount", () => {
  it.each([0, 1, 149_900, MAX_AMOUNT])("accepts %i", (value) => {
    expect(isValidAmount(value)).toBe(true);
  });

  it.each([-1, 0.5, 1499.9, MAX_AMOUNT + 1, Number.NaN, "100", null])(
    "rejects %j",
    (value) => {
      expect(isValidAmount(value)).toBe(false);
    },
  );
});

describe("multiplyAmount", () => {
  it("multiplies integer minor units exactly", () => {
    expect(multiplyAmount(149_900, 3)).toBe(449_700);
    expect(multiplyAmount(6_900, 0)).toBe(0);
  });

  it("rejects fractional quantities and overflow", () => {
    expect(() => multiplyAmount(100, 1.5)).toThrow(InvalidAmountError);
    expect(() => multiplyAmount(100, -1)).toThrow(InvalidAmountError);
    expect(() => multiplyAmount(MAX_AMOUNT, 2)).toThrow(InvalidAmountError);
  });

  it("rejects fractional prices", () => {
    expect(() => multiplyAmount(1499.9, 1)).toThrow(InvalidAmountError);
  });
});

describe("sumAmounts", () => {
  it("sums minor units", () => {
    expect(sumAmounts([149_900, 6_900, 7_900])).toBe(164_700);
    expect(sumAmounts([])).toBe(0);
  });

  it("rejects invalid entries and overflowing sums", () => {
    expect(() => sumAmounts([100, -1])).toThrow(InvalidAmountError);
    expect(() => sumAmounts([MAX_AMOUNT, 1])).toThrow(InvalidAmountError);
  });
});

describe("vatPortionOfGross", () => {
  it("extracts 25 % Swedish VAT from a VAT-inclusive amount", () => {
    // 1 499,00 kr incl. 25 % VAT contains 299,80 kr VAT.
    expect(vatPortionOfGross(149_900, 2_500)).toBe(29_980);
    expect(vatPortionOfGross(12_500, 2_500)).toBe(2_500);
  });

  it("supports other rates without code changes", () => {
    expect(vatPortionOfGross(10_600, 600)).toBe(600);
    expect(vatPortionOfGross(10_000, 0)).toBe(0);
  });

  it("rounds half up to whole öre", () => {
    // 1 × 2500 / 12500 = 0.2 → 0; 3 × 0.2 = 0.6 → 1; 5 × 0.2 = 1.0 → 1
    expect(vatPortionOfGross(1, 2_500)).toBe(0);
    expect(vatPortionOfGross(3, 2_500)).toBe(1);
    expect(vatPortionOfGross(5, 2_500)).toBe(1);
    // 2.5 exactly → 3
    expect(vatPortionOfGross(15, 2_000)).toBe(3);
  });

  it("stays exact at the maximum amount", () => {
    expect(vatPortionOfGross(MAX_AMOUNT, 2_500)).toBe(429_496_729);
  });

  it("rejects invalid rates", () => {
    expect(() => vatPortionOfGross(100, -1)).toThrow(RangeError);
    expect(() => vatPortionOfGross(100, 10_001)).toThrow(RangeError);
    expect(() => vatPortionOfGross(100, 25.5)).toThrow(RangeError);
  });
});

describe("formatSek", () => {
  it("formats öre as Swedish kronor", () => {
    expect(normalizeSpaces(formatSek(149_900))).toBe("1 499,00 kr");
    expect(normalizeSpaces(formatSek(6_900))).toBe("69,00 kr");
    expect(normalizeSpaces(formatSek(0))).toBe("0,00 kr");
  });

  it("refuses non-integer input", () => {
    expect(() => formatSek(14.99)).toThrow(InvalidAmountError);
  });
});
