import { describe, expect, it, vi } from "vitest";

import type { CheckoutSessionInput } from "@/server/checkout/gateway";
import {
  ALLOWED_SHIPPING_COUNTRIES,
  buildCheckoutSessionParams,
  StripeCheckoutGateway,
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
    const gateway = new StripeCheckoutGateway({
      create,
      expire: vi.fn(),
      retrieve: vi.fn(),
    } as never);

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
    const gateway = new StripeCheckoutGateway({
      create: vi.fn().mockResolvedValue({ ...session, url: null }),
    } as never);
    await expect(
      gateway.createCheckoutSession(input, { idempotencyKey: "k" }),
    ).rejects.toThrow("without a URL");
  });

  it("reports the real state when a session can no longer be expired", async () => {
    const gateway = new StripeCheckoutGateway({
      expire: vi.fn().mockRejectedValue(new Error("not open")),
      retrieve: vi.fn().mockResolvedValue({ ...session, status: "complete" }),
    } as never);
    expect(await gateway.expireCheckoutSession("cs_test_123")).toBe("complete");

    const expiring = new StripeCheckoutGateway({
      expire: vi.fn().mockResolvedValue({ ...session, status: "expired" }),
    } as never);
    expect(await expiring.expireCheckoutSession("cs_test_123")).toBe("expired");
  });
});
