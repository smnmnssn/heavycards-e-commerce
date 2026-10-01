import Stripe from "stripe";

import {
  succeededRefundTotal,
  type CheckoutSessionState,
} from "@/server/domain/payment";

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
  "create" | "expire" | "retrieve" | "list"
>;
type RefundsApi = Pick<Stripe["refunds"], "list">;

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
  constructor(
    private readonly api: { sessions: SessionsApi; refunds?: RefundsApi },
  ) {}

  static fromSecretKey(secretKey: string): StripeCheckoutGateway {
    const stripe = new Stripe(secretKey, {
      apiVersion: STRIPE_API_VERSION,
      // Retries reuse the idempotency key, so they never duplicate sessions.
      maxNetworkRetries: 2,
      timeout: 20_000,
      appInfo: { name: "HeavyCards" },
    });
    return new StripeCheckoutGateway({
      sessions: stripe.checkout.sessions,
      refunds: stripe.refunds,
    });
  }

  async createCheckoutSession(
    input: CheckoutSessionInput,
    { idempotencyKey }: { idempotencyKey: string },
  ): Promise<CreatedCheckoutSession> {
    const session = await this.api.sessions.create(
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
      const session = await this.api.sessions.expire(sessionId);
      return toOutcome(session.status);
    } catch {
      // Expiring fails for sessions that are no longer open (already
      // complete or expired); ask Stripe which one it is.
      const session = await this.api.sessions.retrieve(sessionId);
      return toOutcome(session.status);
    }
  }

  async retrieveCheckoutSession(
    sessionId: string,
  ): Promise<CheckoutSessionState> {
    // Stripe's fulfilment guide: always read the session from the API, never
    // from the event payload, which can be a stale snapshot.
    const session = await this.api.sessions.retrieve(sessionId, {
      expand: ["payment_intent.latest_charge"],
    });
    return toSessionState(session);
  }

  async findCheckoutSessionIdForPayment(
    paymentIntentId: string,
  ): Promise<string | null> {
    const page = await this.api.sessions.list({
      payment_intent: paymentIntentId,
      limit: 1,
    });
    return page.data[0]?.id ?? null;
  }

  async retrieveRefundedAmount(
    paymentIntentId: string,
  ): Promise<{ amountRefunded: number; currency: string }> {
    if (!this.api.refunds) throw new Error("Refunds API not configured");
    // Every refund of the payment, in all states, as Stripe reports them now;
    // which ones count is decided by the domain rule.
    const refunds = [];
    for await (const refund of this.api.refunds.list({
      payment_intent: paymentIntentId,
      limit: 100,
    })) {
      refunds.push(refund);
    }
    return succeededRefundTotal(refunds);
  }
}

/** Maps a Stripe Checkout Session to the provider-neutral state. */
export function toSessionState(
  session: Stripe.Checkout.Session,
): CheckoutSessionState {
  const intent =
    session.payment_intent && typeof session.payment_intent === "object"
      ? session.payment_intent
      : null;
  const charge =
    intent?.latest_charge && typeof intent.latest_charge === "object"
      ? intent.latest_charge
      : null;
  const shipping = session.collected_information?.shipping_details ?? null;
  return {
    id: session.id,
    status: session.status,
    paymentStatus: session.payment_status,
    amountTotal: session.amount_total,
    currency: session.currency,
    paymentIntent: intent
      ? {
          id: intent.id,
          status: intent.status,
          paidAt:
            charge?.status === "succeeded"
              ? new Date(charge.created * 1000)
              : null,
        }
      : typeof session.payment_intent === "string"
        ? { id: session.payment_intent, status: "unknown", paidAt: null }
        : null,
    customer: {
      shippingName: shipping?.name ?? null,
      name: session.customer_details?.name ?? null,
      email: session.customer_details?.email ?? null,
      phone: session.customer_details?.phone ?? null,
    },
    shippingAddress: shipping
      ? {
          line1: shipping.address.line1 ?? null,
          line2: shipping.address.line2 ?? null,
          postalCode: shipping.address.postal_code ?? null,
          city: shipping.address.city ?? null,
          country: shipping.address.country ?? null,
        }
      : null,
  };
}

function toOutcome(status: Stripe.Checkout.Session.Status | null) {
  if (status === "expired") return "expired";
  if (status === "complete") return "complete";
  return "open";
}
