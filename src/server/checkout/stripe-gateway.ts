import Stripe from "stripe";

import type {
  CheckoutGateway,
  CheckoutSessionInput,
  CreatedCheckoutSession,
  ExpireOutcome,
} from "./gateway";

/*
 * Stripe Hosted Checkout (PROJECT.md §23–24). HeavyCards never sees card
 * data: the customer pays on checkout.stripe.com.
 *
 * Payment methods are not listed here. Stripe's dynamic payment methods
 * offer whatever is enabled in the Dashboard (cards, Swish, Klarna) and
 * eligible for this session and customer, so nothing claims a method is
 * available when the account cannot offer it. (`payment_method_types` was
 * removed from Checkout Session creation in this API version anyway.)
 */

/**
 * Pinned explicitly so an SDK upgrade cannot silently change API behavior:
 * the typed option only accepts the SDK's own version, so upgrading the SDK
 * fails type checking until this is reviewed.
 */
const STRIPE_API_VERSION = "2026-09-30.endive";

type SessionsApi = Pick<
  Stripe["checkout"]["sessions"],
  "create" | "expire" | "retrieve"
>;

/** Only these countries can be chosen as the shipping address (V1: Sweden). */
export const ALLOWED_SHIPPING_COUNTRIES = ["SE"] as const;

/**
 * Builds the Checkout Session request. Deterministic for a given order, so a
 * retried request with the same idempotency key has identical parameters
 * (Stripe rejects a reused key with different parameters).
 *
 * Personal data is never put in metadata; only internal order identifiers.
 */
export function buildCheckoutSessionParams(
  input: CheckoutSessionInput,
): Stripe.Checkout.SessionCreateParams {
  const metadata = {
    order_id: input.orderId,
    order_number: input.orderNumber,
  };
  return {
    mode: "payment",
    ui_mode: "hosted_page",
    currency: "sek",
    locale: "sv",
    submit_type: "pay",
    line_items: input.lines.map((line) => ({
      quantity: line.quantity,
      price_data: {
        currency: "sek",
        unit_amount: line.unitPriceAmount,
        product_data: { name: line.name },
      },
    })),
    // The shipping name collected with the address is the customer's full
    // name (Order.customerName, stored in Milestone 9).
    shipping_address_collection: {
      allowed_countries: [...ALLOWED_SHIPPING_COUNTRIES],
    },
    shipping_options: [
      {
        shipping_rate_data: {
          type: "fixed_amount",
          display_name:
            input.shippingAmount === 0
              ? `Fri frakt (${input.shippingLabel})`
              : input.shippingLabel,
          fixed_amount: { amount: input.shippingAmount, currency: "sek" },
        },
      },
    ],
    // PostNord delivery notifications use the phone number.
    phone_number_collection: { enabled: true },
    billing_address_collection: "auto",
    customer_creation: "if_required",
    client_reference_id: input.orderId,
    metadata,
    payment_intent_data: {
      metadata,
      description: `HeavyCards ${input.orderNumber}`,
    },
    expires_at: Math.floor(input.expiresAt.getTime() / 1000),
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  };
}

export class StripeCheckoutGateway implements CheckoutGateway {
  constructor(private readonly sessions: SessionsApi) {}

  static fromSecretKey(secretKey: string): StripeCheckoutGateway {
    const stripe = new Stripe(secretKey, {
      apiVersion: STRIPE_API_VERSION,
      // Retries reuse the idempotency key, so they never duplicate sessions.
      maxNetworkRetries: 2,
      timeout: 20_000,
      appInfo: { name: "HeavyCards" },
    });
    return new StripeCheckoutGateway(stripe.checkout.sessions);
  }

  async createCheckoutSession(
    input: CheckoutSessionInput,
    { idempotencyKey }: { idempotencyKey: string },
  ): Promise<CreatedCheckoutSession> {
    const session = await this.sessions.create(
      buildCheckoutSessionParams(input),
      { idempotencyKey },
    );
    if (!session.url) {
      throw new Error("Stripe returned a Checkout Session without a URL");
    }
    return {
      id: session.id,
      url: session.url,
      expiresAt: new Date(session.expires_at * 1000),
      amountTotal: session.amount_total,
      currency: session.currency,
    };
  }

  async expireCheckoutSession(sessionId: string): Promise<ExpireOutcome> {
    try {
      const session = await this.sessions.expire(sessionId);
      return toOutcome(session.status);
    } catch {
      // Expiring fails for sessions that are no longer open (already
      // complete or expired); ask Stripe which one it is.
      const session = await this.sessions.retrieve(sessionId);
      return toOutcome(session.status);
    }
  }
}

function toOutcome(status: Stripe.Checkout.Session.Status | null) {
  if (status === "expired") return "expired";
  if (status === "complete") return "complete";
  return "open";
}
