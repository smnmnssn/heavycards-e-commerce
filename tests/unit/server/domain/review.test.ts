import { describe, expect, it } from "vitest";

import type {
  FulfillmentStatus,
  PaymentStatus,
  ReviewStatus,
} from "@/generated/prisma/enums";
import {
  canModerate,
  changesPublicReviews,
  moderationTarget,
  orderAllowsReviews,
} from "@/server/domain/review";

const STATUSES: ReviewStatus[] = ["PENDING", "APPROVED", "REJECTED"];

describe("moderation transitions", () => {
  it("maps decisions to statuses", () => {
    expect(moderationTarget("APPROVE")).toBe("APPROVED");
    expect(moderationTarget("REJECT")).toBe("REJECTED");
  });

  it.each([
    ["PENDING", "APPROVED"],
    ["PENDING", "REJECTED"],
    ["APPROVED", "REJECTED"],
    ["REJECTED", "APPROVED"],
  ] as const)("allows %s → %s", (from, to) => {
    expect(canModerate(from, to)).toBe(true);
  });

  it("never returns a review to PENDING", () => {
    for (const from of STATUSES) {
      expect(canModerate(from, "PENDING")).toBe(false);
    }
  });

  it("changes the storefront only to or from APPROVED", () => {
    expect(changesPublicReviews("PENDING", "APPROVED")).toBe(true);
    expect(changesPublicReviews("APPROVED", "REJECTED")).toBe(true);
    expect(changesPublicReviews("REJECTED", "APPROVED")).toBe(true);
    expect(changesPublicReviews("PENDING", "REJECTED")).toBe(false);
    expect(changesPublicReviews("APPROVED", "APPROVED")).toBe(false);
  });
});

describe("orderAllowsReviews", () => {
  const shipped = {
    paymentStatus: "PAID" as PaymentStatus,
    fulfillmentStatus: "SHIPPED" as FulfillmentStatus,
    shippedAt: new Date("2026-09-20T10:00:00Z"),
  };

  it.each(["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] as const)(
    "allows a shipped order that was paid (%s now)",
    (paymentStatus) => {
      expect(orderAllowsReviews({ ...shipped, paymentStatus })).toBe(true);
    },
  );

  it.each(["PENDING", "FAILED", "EXPIRED"] as const)(
    "never allows an unpaid order (%s)",
    (paymentStatus) => {
      expect(orderAllowsReviews({ ...shipped, paymentStatus })).toBe(false);
    },
  );

  it("allows completed orders but not orders that never shipped", () => {
    expect(
      orderAllowsReviews({ ...shipped, fulfillmentStatus: "COMPLETED" }),
    ).toBe(true);
    for (const fulfillmentStatus of [
      "NEW",
      "PROCESSING",
      "CANCELLED",
    ] as const) {
      expect(orderAllowsReviews({ ...shipped, fulfillmentStatus })).toBe(false);
    }
    expect(orderAllowsReviews({ ...shipped, shippedAt: null })).toBe(false);
  });
});
