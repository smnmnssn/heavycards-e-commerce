import type { FulfillmentStatus } from "@/generated/prisma/enums";

/**
 * Allowed fulfillment transitions (PROJECT.md §29, §39). Fulfillment is
 * independent of payment status; whether an order may be fulfilled at all
 * (e.g. only when paid) is checked by the order service, not here.
 */
const ALLOWED_TRANSITIONS: Readonly<
  Record<FulfillmentStatus, readonly FulfillmentStatus[]>
> = {
  NEW: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function allowedFulfillmentTransitions(
  from: FulfillmentStatus,
): readonly FulfillmentStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

export function canTransitionFulfillment(
  from: FulfillmentStatus,
  to: FulfillmentStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
