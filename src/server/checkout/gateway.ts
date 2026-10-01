import type { CheckoutSessionState } from "@/server/domain/payment";

/*
 * The only boundary between checkout and the payment provider. Checkout code
 * depends on this interface, so domain and database tests run with
 * FakeCheckoutGateway and never contact Stripe. The production
 * implementation is StripeCheckoutGateway (./stripe-gateway.ts).
 */

/** Everything the payment page needs, derived from the pending order. */
export type CheckoutSessionInput = {
  orderId: string;
  /** Public order number, e.g. "HC-10001" (display only). */
  orderNumber: string;
  lines: ReadonlyArray<{
    name: string;
    quantity: number;
    /** VAT-inclusive öre. */
    unitPriceAmount: number;
  }>;
  shippingAmount: number;
  /** Carrier label shown on the payment page, e.g. "PostNord". */
  shippingLabel: string;
  totalAmount: number;
  /** When the payment page stops accepting payment. */
  expiresAt: Date;
  successUrl: string;
  cancelUrl: string;
};

export type CreatedCheckoutSession = {
  id: string;
  url: string;
  expiresAt: Date;
  /** As reported by the provider, to verify against the order. */
  amountTotal: number | null;
  /** Lowercase ISO code as reported by the provider. */
  currency: string | null;
};

/**
 * - `expired`: the session can no longer be paid.
 * - `complete`: the customer finished checkout (its payment outcome is
 *   applied by src/server/payments).
 * - `open`: still payable; expiring it failed.
 */
export type ExpireOutcome = "expired" | "complete" | "open";

export interface CheckoutGateway {
  /**
   * Creates a hosted payment page. Calls with the same idempotency key and
   * input return the same session instead of creating another one.
   */
  createCheckoutSession(
    input: CheckoutSessionInput,
    options: { idempotencyKey: string },
  ): Promise<CreatedCheckoutSession>;

  /** Stops an open session from accepting payment. */
  expireCheckoutSession(sessionId: string): Promise<ExpireOutcome>;

  /**
   * The session's current, authoritative state, including its payment and
   * the customer details collected by Checkout. Throws when the provider is
   * unreachable (callers must then keep stock reserved).
   */
  retrieveCheckoutSession(sessionId: string): Promise<CheckoutSessionState>;

  /** The Checkout Session that created a payment, if any. */
  findCheckoutSessionIdForPayment(
    paymentIntentId: string,
  ): Promise<string | null>;

  /**
   * The amount successfully refunded on a payment, from the provider's
   * current refund list (succeeded refunds only; see succeededRefundTotal).
   */
  retrieveRefundedAmount(
    paymentIntentId: string,
  ): Promise<{ amountRefunded: number; currency: string }>;
}
