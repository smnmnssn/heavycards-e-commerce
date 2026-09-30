import { describe, expect, it } from "vitest";

import type { ProductStatus } from "@/generated/prisma/enums";
import {
  availabilityLabels,
  getAvailability,
  hasPublicPage,
  isFutureRelease,
  isListable,
  isNewArrival,
  isPurchasable,
  newArrivalsSince,
} from "@/server/domain/catalog";

const now = new Date("2026-10-01T10:00:00Z");
const past = new Date("2026-09-01T00:00:00Z");
const future = new Date("2026-12-01T00:00:00Z");

describe("isListable / hasPublicPage", () => {
  it.each<[ProductStatus, Date | null, boolean, boolean]>([
    ["ACTIVE", past, true, true],
    ["COMING_SOON", past, true, true],
    ["DRAFT", past, false, false],
    ["DRAFT", null, false, false],
    ["ARCHIVED", past, false, true],
    ["ARCHIVED", null, false, false],
    ["ACTIVE", null, false, false],
    ["ACTIVE", future, false, false],
  ])(
    "%s published %s → listed %s, page %s",
    (status, publishedAt, listed, page) => {
      expect(isListable({ status, publishedAt }, now)).toBe(listed);
      expect(hasPublicPage({ status, publishedAt }, now)).toBe(page);
    },
  );
});

describe("getAvailability", () => {
  const base = { lowStockThreshold: 3, isPreorder: false } as const;

  it.each([
    [{ status: "ACTIVE", availableQuantity: 10 }, "in_stock"],
    [{ status: "ACTIVE", availableQuantity: 3 }, "low_stock"],
    [{ status: "ACTIVE", availableQuantity: 1 }, "low_stock"],
    [{ status: "ACTIVE", availableQuantity: 0 }, "sold_out"],
    [{ status: "COMING_SOON", availableQuantity: 5 }, "coming_soon"],
    [{ status: "COMING_SOON", availableQuantity: 0 }, "coming_soon"],
    [{ status: "ARCHIVED", availableQuantity: 5 }, "discontinued"],
    [
      { status: "COMING_SOON", availableQuantity: 5, isPreorder: true },
      "preorder",
    ],
    [{ status: "ACTIVE", availableQuantity: 5, isPreorder: true }, "preorder"],
    [
      { status: "COMING_SOON", availableQuantity: 0, isPreorder: true },
      "preorder_sold_out",
    ],
  ] as const)("%j → %s", (input, expected) => {
    expect(getAvailability({ ...base, ...input })).toBe(expected);
  });

  it("never shows low stock when the threshold is 0 (no settings)", () => {
    expect(
      getAvailability({
        status: "ACTIVE",
        isPreorder: false,
        availableQuantity: 1,
        lowStockThreshold: 0,
      }),
    ).toBe("in_stock");
  });

  it("treats only in stock, low stock and preorder as purchasable", () => {
    const purchasable = (
      Object.keys(availabilityLabels) as Array<keyof typeof availabilityLabels>
    ).filter(isPurchasable);

    expect(purchasable.sort()).toEqual(["in_stock", "low_stock", "preorder"]);
  });

  it("has a Swedish label for every state", () => {
    expect(availabilityLabels).toMatchObject({
      in_stock: "I lager",
      sold_out: "Slutsåld",
      coming_soon: "Kommer snart",
      preorder: "Förbeställ",
    });
  });
});

describe("new arrivals and releases", () => {
  it("marks products published within 30 days as new", () => {
    expect(isNewArrival(new Date("2026-09-20T00:00:00Z"), now)).toBe(true);
    expect(isNewArrival(new Date("2026-08-01T00:00:00Z"), now)).toBe(false);
    expect(isNewArrival(future, now)).toBe(false);
    expect(isNewArrival(null, now)).toBe(false);
  });

  it("defines the new-arrivals window as 60 days", () => {
    expect(newArrivalsSince(now).toISOString()).toBe(
      "2026-08-02T10:00:00.000Z",
    );
  });

  it("compares release dates as calendar dates", () => {
    expect(isFutureRelease("2026-10-02", "2026-10-01")).toBe(true);
    expect(isFutureRelease("2026-10-01", "2026-10-01")).toBe(false);
    expect(isFutureRelease(null, "2026-10-01")).toBe(false);
  });
});
