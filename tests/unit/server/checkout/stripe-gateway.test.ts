import { describe, expect, it, vi } from "vitest";

import type { CheckoutSessionInput } from "@/server/checkout/gateway";
import {
  ALLOWED_SHIPPING_COUNTRIES,
  buildCheckoutSessionParams,
  StripeCheckoutGateway,
  toSessionState,
} from "@/server/checkout/stripe-gateway";

const input: CheckoutSessionInput = {
  orderId: "01999999-0000-7000-8000-0000000000aa",
  orderNumber: "HC-10001",
  lines: [
    {
      name: "Destined Rivals Booster Box",
      quantity: 2,
      unitPriceAmount: 219_900,
    },
    { name: "Booster Pack", quantity: 1, unitPriceAmount: 6_900 },
  ],
  shippingAmount: 0,
  shippingLabel: "PostNord",
  totalAmount: 446_700,
  expiresAt: new Date("2026-10-01T12:40:00Z"),
  successUrl:
    "https://heavycards.se/kassa/bekraftelse?session_id={CHECKOUT_SESSION_ID}",
  cancelUrl: "https://heavycards.se/kassa/avbruten",
};

describe("buildCheckoutSessionParams", () => {
  const params = buildCheckoutSessionParams(input);

  it("creates a hosted, Swedish, SEK payment session", () => {
    expect(params).toMatchObject({
      mode: "payment",
      ui_mode: "hosted_page",
      currency: "sek",
      locale: "sv",
      expires_at: Date.parse("2026-10-01T12:40:00Z") / 1000,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    });
  });

  it("lets only Sweden be chosen as shipping country", () => {
    expect(ALLOWED_SHIPPING_COUNTRIES).toEqual(["SE"]);
    expect(params.shipping_address_collection).toEqual({
      allowed_countries: ["SE"],
    });
  });

  it("collects contact and delivery details in Stripe instead of a HeavyCards form", () => {
    expect(params.phone_number_collection).toEqual({ enabled: true });
    expect(params.customer_email).toBeUndefined();
    expect(params.customer).toBeUndefined();
  });

  it("charges exactly the order's lines and shipping", () => {
    expect(params.line_items).toEqual([
      {
        quantity: 2,
        price_data: {
          currency: "sek",
          unit_amount: 219_900,
          product_data: { name: "Destined Rivals Booster Box" },
        },
      },
      {
        quantity: 1,
        price_data: {
          currency: "sek",
          unit_amount: 6_900,
          product_data: { name: "Booster Pack" },
        },
      },
    ]);
    expect(params.shipping_options).toEqual([
      {
        shipping_rate_data: {
          type: "fixed_amount",
          display_name: "Fri frakt (PostNord)",
          fixed_amount: { amount: 0, currency: "sek" },
        },
      },
    ]);
    expect(
      buildCheckoutSessionParams({ ...input, shippingAmount: 7_900 })
        .shipping_options,
    ).toEqual([
      {
        shipping_rate_data: {
          type: "fixed_amount",
          display_name: "PostNord",
          fixed_amount: { amount: 7_900, currency: "sek" },
        },
      },
    ]);
  });

  it("lets Stripe choose eligible payment methods dynamically", () => {
    expect(params).not.toHaveProperty("payment_method_types");
    expect(params).not.toHaveProperty("allowed_payment_method_types");
  });

  it("identifies the order without personal data", () => {
    const metadata = {
      order_id: input.orderId,
      order_number: "HC-10001",
    };
    expect(params.client_reference_id).toBe(input.orderId);
    expect(params.metadata).toEqual(metadata);
    expect(params.payment_intent_data).toEqual({
      metadata,
      description: "HeavyCards HC-10001",
    });
  });

  it("is deterministic, so idempotent retries send identical parameters", () => {
    expect(buildCheckoutSessionParams(input)).toEqual(params);
  });
});

const gatewayWith = (sessions: object, refunds?: object) =>
  new StripeCheckoutGateway({ sessions, refunds } as never);

describe("StripeCheckoutGateway", () => {
  const session = {
    id: "cs_test_123",
    url: "https://checkout.stripe.com/c/pay/cs_test_123",
    expires_at: 1_790_000_000,
    amount_total: 446_700,
    currency: "sek",
    status: "open",
  };

  it("passes the idempotency key and maps the session", async () => {
    const create = vi.fn().mockResolvedValue(session);
    const gateway = gatewayWith({
      create,
      expire: vi.fn(),
      retrieve: vi.fn(),
    });

    const created = await gateway.createCheckoutSession(input, {
      idempotencyKey: "heavycards-checkout-x",
    });

    expect(create).toHaveBeenCalledWith(buildCheckoutSessionParams(input), {
      idempotencyKey: "heavycards-checkout-x",
    });
    expect(created).toEqual({
      id: "cs_test_123",
      url: session.url,
      expiresAt: new Date(1_790_000_000_000),
      amountTotal: 446_700,
      currency: "sek",
    });
  });

  it("refuses a session without a URL", async () => {
    const gateway = gatewayWith({
      create: vi.fn().mockResolvedValue({ ...session, url: null }),
    });
    await expect(
      gateway.createCheckoutSession(input, { idempotencyKey: "k" }),
    ).rejects.toThrow("without a URL");
  });

  it("reports the real state when a session can no longer be expired", async () => {
    const gateway = gatewayWith({
      expire: vi.fn().mockRejectedValue(new Error("not open")),
      retrieve: vi.fn().mockResolvedValue({ ...session, status: "complete" }),
    });
    expect(await gateway.expireCheckoutSession("cs_test_123")).toBe("complete");

    const expiring = gatewayWith({
      expire: vi.fn().mockResolvedValue({ ...session, status: "expired" }),
    });
    expect(await expiring.expireCheckoutSession("cs_test_123")).toBe("expired");
  });

  it("reads the session from the API with its payment, never from an event", async () => {
    const retrieve = vi.fn().mockResolvedValue(paidSession);
    const gateway = gatewayWith({ retrieve });

    const state = await gateway.retrieveCheckoutSession("cs_test_paid");

    expect(retrieve).toHaveBeenCalledWith("cs_test_paid", {
      expand: ["payment_intent.latest_charge"],
    });
    expect(state).toEqual({
      id: "cs_test_paid",
      status: "complete",
      paymentStatus: "paid",
      amountTotal: 77_800,
      currency: "sek",
      paymentIntent: {
        id: "pi_test_1",
        status: "succeeded",
        paidAt: new Date(1_790_000_100_000),
      },
      customer: {
        shippingName: "Anna-Karin von Essen",
        name: "A. K. von Essen",
        email: "anna@example.com",
        phone: "+46701234567",
      },
      shippingAddress: {
        line1: "Storgatan 1",
        line2: "lgh 1102",
        postalCode: "111 22",
        city: "Stockholm",
        country: "SE",
      },
    });
  });

  it("maps a session whose payment is not expanded", () => {
    expect(
      toSessionState({
        ...paidSession,
        payment_intent: "pi_test_2",
        collected_information: null,
      } as never),
    ).toMatchObject({
      paymentIntent: { id: "pi_test_2", status: "unknown", paidAt: null },
      shippingAddress: null,
      customer: { shippingName: null },
    });
  });

  it("finds the session of a payment", async () => {
    const list = vi.fn().mockResolvedValue({ data: [{ id: "cs_test_x" }] });
    expect(
      await gatewayWith({ list }).findCheckoutSessionIdForPayment("pi_1"),
    ).toBe("cs_test_x");
    expect(list).toHaveBeenCalledWith({ payment_intent: "pi_1", limit: 1 });
    expect(
      await gatewayWith({
        list: vi.fn().mockResolvedValue({ data: [] }),
      }).findCheckoutSessionIdForPayment("pi_2"),
    ).toBeNull();
  });

  it("counts only succeeded refunds across all of a payment's refunds", async () => {
    const refunds = [
      { amount: 1_000, status: "succeeded", currency: "sek" },
      { amount: 600, status: "succeeded", currency: "sek" },
      { amount: 2_000, status: "pending", currency: "sek" },
      { amount: 400, status: "requires_action", currency: "sek" },
      { amount: 5_000, status: "failed", currency: "sek" },
      { amount: 7_000, status: "canceled", currency: "sek" },
    ];
    const list = vi.fn(() => ({
      async *[Symbol.asyncIterator]() {
        yield* refunds;
      },
    }));

    expect(
      await gatewayWith({}, { list }).retrieveRefundedAmount("pi_1"),
    ).toEqual({ amountRefunded: 1_600, currency: "sek" });
    expect(list).toHaveBeenCalledWith({ payment_intent: "pi_1", limit: 100 });
  });
});

const paidSession = {
  id: "cs_test_paid",
  status: "complete",
  payment_status: "paid",
  amount_total: 77_800,
  currency: "sek",
  payment_intent: {
    id: "pi_test_1",
    status: "succeeded",
    latest_charge: { status: "succeeded", created: 1_790_000_100 },
  },
  customer_details: {
    name: "A. K. von Essen",
    email: "anna@example.com",
    phone: "+46701234567",
  },
  collected_information: {
    shipping_details: {
      name: "Anna-Karin von Essen",
      address: {
        line1: "Storgatan 1",
        line2: "lgh 1102",
        postal_code: "111 22",
        city: "Stockholm",
        country: "SE",
      },
    },
  },
};
