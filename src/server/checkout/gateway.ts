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
 * - `complete`: the customer finished checkout (payment handled in M9).
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
}
