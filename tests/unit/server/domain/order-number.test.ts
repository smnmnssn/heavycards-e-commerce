import { describe, expect, it } from "vitest";

import {
  formatOrderNumber,
  parseOrderNumber,
} from "@/server/domain/order-number";

describe("formatOrderNumber", () => {
  it("prefixes the sequence value", () => {
    expect(formatOrderNumber(10_001)).toBe("HC-10001");
    expect(formatOrderNumber(123_456)).toBe("HC-123456");
  });

  it.each([0, 10_000, 10_001.5, -10_001])("rejects %d", (value) => {
    expect(() => formatOrderNumber(value)).toThrow(RangeError);
  });
});

describe("parseOrderNumber", () => {
  it.each([
    ["HC-10001", 10_001],
    ["hc-10001", 10_001],
    [" HC 10042 ", 10_042],
    ["HC10042", 10_042],
    ["10042", 10_042],
  ])("parses %j", (input, expected) => {
    expect(parseOrderNumber(input)).toBe(expected);
  });

  it.each([
    "",
    "HC-",
    "HC-9999",
    "HC-10001-1",
    "XY-10001",
    "10001; DROP",
    "1e5",
  ])("rejects %j", (input) => {
    expect(parseOrderNumber(input)).toBeNull();
  });

  it("round-trips with formatOrderNumber", () => {
    expect(parseOrderNumber(formatOrderNumber(10_777))).toBe(10_777);
  });
});
