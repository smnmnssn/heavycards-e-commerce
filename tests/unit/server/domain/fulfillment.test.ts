import { describe, expect, it } from "vitest";

import type {
  FulfillmentStatus,
  PaymentStatus,
} from "@/generated/prisma/enums";
import {
  allowedFulfillmentTransitions,
  canTransitionFulfillment,
  fulfillmentAllowedForPayment,
} from "@/server/domain/fulfillment";

describe("fulfillment transitions", () => {
  it.each<[FulfillmentStatus, FulfillmentStatus]>([
    ["NEW", "PROCESSING"],
    ["PROCESSING", "SHIPPED"],
    ["SHIPPED", "COMPLETED"],
    ["NEW", "CANCELLED"],
    ["PROCESSING", "CANCELLED"],
  ])("allows %s → %s", (from, to) => {
    expect(canTransitionFulfillment(from, to)).toBe(true);
  });

  it.each<[FulfillmentStatus, FulfillmentStatus]>([
    ["NEW", "SHIPPED"],
    ["SHIPPED", "PROCESSING"],
    ["SHIPPED", "SHIPPED"],
    ["SHIPPED", "CANCELLED"],
    ["COMPLETED", "PROCESSING"],
    ["CANCELLED", "PROCESSING"],
  ])("rejects %s → %s", (from, to) => {
    expect(canTransitionFulfillment(from, to)).toBe(false);
  });

  it("treats COMPLETED and CANCELLED as final", () => {
    expect(allowedFulfillmentTransitions("COMPLETED")).toEqual([]);
    expect(allowedFulfillmentTransitions("CANCELLED")).toEqual([]);
  });
});

describe("payment precondition (Milestone 10)", () => {
  it.each<[FulfillmentStatus, PaymentStatus, boolean]>([
    ["PROCESSING", "PAID", true],
    ["PROCESSING", "PARTIALLY_REFUNDED", true],
    ["PROCESSING", "PENDING", false],
    ["PROCESSING", "REFUNDED", false],
    ["SHIPPED", "PAID", true],
    ["SHIPPED", "PENDING", false],
    ["SHIPPED", "FAILED", false],
    ["SHIPPED", "EXPIRED", false],
    ["SHIPPED", "REFUNDED", false],
    ["COMPLETED", "REFUNDED", true],
    ["CANCELLED", "PENDING", true],
    ["CANCELLED", "REFUNDED", true],
  ])("%s with payment %s: %s", (to, paymentStatus, allowed) => {
    expect(fulfillmentAllowedForPayment(to, paymentStatus)).toBe(allowed);
  });
});
