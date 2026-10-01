import { describe, expect, it } from "vitest";

import { formatSekInput, MAX_AMOUNT, parseSekInput } from "@/lib/money";

describe("parseSekInput", () => {
  it.each([
    ["1499", 149_900],
    ["1 499", 149_900],
    ["1 499,00", 149_900],
    ["1499,5", 149_950],
    ["1499.50", 149_950],
    ["0,99", 99],
    ["49 kr", 4_900],
    ["49:-", 4_900],
    [" 12 ", 1_200],
    ["0", 0],
  ])("%j → %d öre", (input, expected) => {
    expect(parseSekInput(input)).toBe(expected);
  });

  it.each([
    "",
    "-10",
    "12,345",
    "1,2,3",
    "abc",
    "1e3",
    "12.5.0",
    "Infinity",
    "99999999",
    String(MAX_AMOUNT),
  ])("rejects %j", (input) => {
    expect(parseSekInput(input)).toBeNull();
  });

  it("never uses floating point (0,29 kr is exactly 29 öre)", () => {
    expect(parseSekInput("0,29")).toBe(29);
    expect(parseSekInput("1,10")).toBe(110);
  });
});

describe("formatSekInput", () => {
  it.each([
    [149_900, "1499"],
    [149_950, "1499,50"],
    [105, "1,05"],
    [0, "0"],
  ])("%d → %j and back", (amount, text) => {
    expect(formatSekInput(amount)).toBe(text);
    expect(parseSekInput(text)).toBe(amount);
  });
});
