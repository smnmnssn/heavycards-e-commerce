import { describe, expect, it } from "vitest";

import type { FulfillmentStatus } from "@/generated/prisma/enums";
import {
  allowedFulfillmentTransitions,
  canTransitionFulfillment,
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
