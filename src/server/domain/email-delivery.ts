import type {
  EmailKind,
  FulfillmentStatus,
  PaymentStatus,
} from "@/generated/prisma/enums";
import type { DeliveryFailure } from "@/lib/email/transport";

/*
 * Rules for transactional email delivery (src/server/email/outbox.ts).
 *
 * Exactly-once has two layers:
 * 1. HeavyCards' own durable state: one EmailDelivery row per order and kind
 *    (unique), claimed with a lease before every attempt, and never sent
 *    again once SENT.
 * 2. The provider's idempotency key, which is deterministic per order and
 *    kind. It covers the one gap the first layer cannot close: an attempt
 *    whose outcome is unknown (timeout, crash after sending). Resend
 *    honours a key for 24 hours, so such a retry is only safe inside that
 *    window; after it, a person decides (FAILED) instead of risking a
 *    duplicate.
 */

const KEY_PREFIX: Readonly<Record<EmailKind, string>> = {
  ORDER_CONFIRMATION: "order-confirmation",
  ORDER_SHIPPED: "order-shipped",
};

/** `order-confirmation/<order id>`: stable across retries, crashes and runs. */
export function emailIdempotencyKey(kind: EmailKind, orderId: string): string {
  return `${KEY_PREFIX[kind]}/${orderId}`;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Wait before retry n (after the n-th failed attempt). The whole sequence
 * (about 10 hours) fits inside the provider's idempotency window, so with a
 * frequent enough scheduler an unknown outcome is always retried safely.
 */
export const RETRY_DELAYS_MS: readonly number[] = [
  1 * MINUTE_MS,
  5 * MINUTE_MS,
  15 * MINUTE_MS,
  1 * HOUR_MS,
  3 * HOUR_MS,
  6 * HOUR_MS,
];

/** The first attempt plus one per retry delay; then a person decides. */
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

/**
 * Resend keeps idempotency keys for 24 hours. One hour of margin covers
 * clock differences and a send in flight at the boundary.
 */
export const PROVIDER_IDEMPOTENCY_WINDOW_MS = 23 * HOUR_MS;

/**
 * How long a claimed delivery stays leased to one dispatcher. Longer than
 * the transport timeout, so a live attempt is never taken over; a lease that
 * lapses without a result means the dispatcher crashed.
 */
export const SEND_LEASE_MS = 2 * MINUTE_MS;

export type FailureDecision =
  | { action: "retry"; nextAttemptAt: Date }
  | { action: "give_up"; problem: string };

/** What to do after attempt number `attempts` failed. */
export function decideAfterFailure({
  attempts,
  failure,
  code,
  now,
}: {
  attempts: number;
  failure: DeliveryFailure;
  code: string;
  now: Date;
}): FailureDecision {
  // The provider saw this key with a different message: the first one may
  // have been delivered, and a new key could duplicate it.
  if (failure === "conflict") return { action: "give_up", problem: code };
  if (attempts >= MAX_ATTEMPTS) {
    return { action: "give_up", problem: "max_attempts" };
  }
  const delay =
    RETRY_DELAYS_MS[Math.max(0, attempts - 1)] ?? RETRY_DELAYS_MS.at(-1)!;
  return { action: "retry", nextAttemptAt: new Date(now.getTime() + delay) };
}

/**
 * True when an earlier attempt's outcome is unknown and the provider may no
 * longer recognise the idempotency key: retrying could then send twice.
 */
export function providerWindowExpired(
  outcomeUnknownSince: Date | null,
  now: Date,
): boolean {
  return (
    outcomeUnknownSince !== null &&
    now.getTime() - outcomeUnknownSince.getTime() >=
      PROVIDER_IDEMPOTENCY_WINDOW_MS
  );
}

/** Payment states in which a paid order's confirmation is still due. */
export const CONFIRMATION_PAYMENT_STATES = [
  "PAID",
  "PARTIALLY_REFUNDED",
] as const satisfies readonly PaymentStatus[];

export type Eligibility = { ok: true } | { ok: false; reason: string };

/**
 * Re-checked when sending, because the order may have changed since the
 * obligation was created:
 * - a confirmation only for an order HeavyCards considers paid. A fully
 *   refunded order is not confirmed any more (the customer would be thanked
 *   for an order that no longer exists);
 * - a shipping email only once the order has actually been shipped.
 */
export function deliveryEligibility(
  kind: EmailKind,
  order: { paymentStatus: PaymentStatus; fulfillmentStatus: FulfillmentStatus },
): Eligibility {
  switch (kind) {
    case "ORDER_CONFIRMATION":
      if (
        (CONFIRMATION_PAYMENT_STATES as readonly PaymentStatus[]).includes(
          order.paymentStatus,
        )
      ) {
        return { ok: true };
      }
      return {
        ok: false,
        reason:
          order.paymentStatus === "REFUNDED"
            ? "order_refunded"
            : "order_not_paid",
      };
    case "ORDER_SHIPPED":
      return order.fulfillmentStatus === "SHIPPED" ||
        order.fulfillmentStatus === "COMPLETED"
        ? { ok: true }
        : { ok: false, reason: "order_not_shipped" };
  }
}
