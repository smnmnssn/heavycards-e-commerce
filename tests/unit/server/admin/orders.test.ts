import { describe, expect, it } from "vitest";

import {
  adminOrdersHref,
  fulfillmentStatusesFor,
  parseAdminOrderParams,
  parseOrderSearch,
  paymentStatusesFor,
} from "@/server/admin/orders/list-params";
import { fulfillmentInputFromForm } from "@/server/admin/orders/fulfillment-form";
import {
  describeAttention,
  describeOrderEvent,
  isAttentionEntry,
  publicOrderNumber,
} from "@/server/admin/orders/presenters";
import {
  stripeDashboardIsLive,
  stripePaymentUrl,
} from "@/server/admin/orders/stripe-links";
import { storeSettingsRevalidationTargets } from "@/server/admin/settings/revalidation";

describe("order list parameters", () => {
  it("defaults to newest first without filters", () => {
    expect(parseAdminOrderParams({})).toEqual({
      q: "",
      payment: "",
      fulfillment: "",
      attention: false,
      from: "",
      to: "",
      sort: "nyast",
      page: 1,
    });
  });

  it("parses valid values and ignores invalid ones", () => {
    expect(
      parseAdminOrderParams({
        q: "  HC-10001 ",
        betalning: "REFUNDED",
        leverans: "att-hantera",
        atgard: "1",
        fran: "2026-10-01",
        till: ["2026-10-31", "x"],
        sortering: "belopp",
        sida: "3",
      }),
    ).toEqual({
      q: "HC-10001",
      payment: "REFUNDED",
      fulfillment: "att-hantera",
      attention: true,
      from: "2026-10-01",
      to: "2026-10-31",
      sort: "belopp",
      page: 3,
    });
    expect(
      parseAdminOrderParams({
        betalning: "DROP TABLE",
        leverans: "x",
        atgard: "yes",
        fran: "2026-13-01",
        till: "igår",
        sortering: "random",
        sida: "-2",
        q: "x".repeat(101),
      }),
    ).toEqual(parseAdminOrderParams({}));
  });

  it("hides abandoned checkouts by default, except when looking for problems", () => {
    expect(paymentStatusesFor("", false)).toEqual([
      "PENDING",
      "PAID",
      "PARTIALLY_REFUNDED",
      "REFUNDED",
      "FAILED",
    ]);
    expect(paymentStatusesFor("", true)).toBeNull();
    expect(paymentStatusesFor("alla", false)).toBeNull();
    expect(paymentStatusesFor("betalda", true)).toEqual([
      "PAID",
      "PARTIALLY_REFUNDED",
    ]);
    expect(paymentStatusesFor("EXPIRED", false)).toEqual(["EXPIRED"]);
    expect(fulfillmentStatusesFor("att-hantera")).toEqual([
      "NEW",
      "PROCESSING",
    ]);
    expect(fulfillmentStatusesFor("")).toBeNull();
  });

  it("interprets the search box", () => {
    expect(parseOrderSearch("HC-10001")).toEqual({
      kind: "orderNumber",
      orderNumber: 10001,
    });
    expect(parseOrderSearch("hc10002")).toEqual({
      kind: "orderNumber",
      orderNumber: 10002,
    });
    expect(parseOrderSearch("pi_3Abc_def")).toEqual({
      kind: "stripeId",
      id: "pi_3Abc_def",
    });
    expect(parseOrderSearch("Anna  ANDERSSON")).toEqual({
      kind: "text",
      terms: ["anna", "andersson"],
    });
    expect(parseOrderSearch(" ")).toEqual({ kind: "none" });
  });

  it("builds list URLs that keep the other filters", () => {
    const params = parseAdminOrderParams({
      q: "anna",
      leverans: "NEW",
      atgard: "1",
    });
    expect(adminOrdersHref(params, { page: 2 })).toBe(
      "/admin/orders?q=anna&leverans=NEW&atgard=1&sida=2",
    );
    expect(adminOrdersHref(parseAdminOrderParams({}))).toBe("/admin/orders");
  });
});

describe("fulfillment form input", () => {
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };

  it("passes tracking details only when shipping", () => {
    expect(
      fulfillmentInputFromForm(
        form({
          orderId: "o",
          to: "PROCESSING",
          trackingNumber: "X",
          shippingCarrier: "OTHER",
        }),
      ),
    ).toEqual({ orderId: "o", to: "PROCESSING" });
    expect(
      fulfillmentInputFromForm(
        form({ orderId: "o", to: "SHIPPED", shippingCarrier: "POSTNORD" }),
      ),
    ).toEqual({
      orderId: "o",
      to: "SHIPPED",
      trackingNumber: "",
      shippingCarrier: "POSTNORD",
    });
  });
});

describe("order presenters", () => {
  it("formats the public order number, never the database ID", () => {
    expect(publicOrderNumber(10001)).toBe("HC-10001");
  });

  it("recognizes attention entries", () => {
    expect(isAttentionEntry("PAYMENT_NEEDS_ATTENTION", {})).toBe(true);
    expect(isAttentionEntry("EMAIL_NEEDS_ATTENTION", null)).toBe(true);
    expect(isAttentionEntry("MARK_ORDER_PAID", { stockShortfalls: [] })).toBe(
      true,
    );
    expect(isAttentionEntry("MARK_ORDER_PAID", { source: "webhook" })).toBe(
      false,
    );
    expect(isAttentionEntry("UPDATE_ORDER_STATUS", {})).toBe(false);
  });

  it("describes payment, email and stock problems in Swedish", () => {
    expect(
      describeAttention("PAYMENT_NEEDS_ATTENTION", {
        problem: "amount_mismatch",
      }),
    ).toMatchObject({
      kind: "payment",
      title: "Beloppet hos Stripe stämmer inte med beställningens total.",
      guidance: expect.stringContaining("Stripe Dashboard"),
    });
    expect(
      describeAttention("PAYMENT_NEEDS_ATTENTION", { problem: "new_code" })
        .title,
    ).toBe("Betalningen kunde inte stämmas av mot Stripe.");
    expect(
      describeAttention("EMAIL_NEEDS_ATTENTION", {
        kind: "ORDER_SHIPPED",
        problem: "max_attempts",
      }),
    ).toMatchObject({
      kind: "email",
      title:
        "Leveransbesked kunde inte skickas. Alla automatiska försök misslyckades.",
      guidance: expect.stringContaining("Resend"),
    });
    expect(
      describeAttention("MARK_ORDER_PAID", {
        stockShortfalls: [
          { productId: "a", missing: 2 },
          { productId: "b", missing: 1 },
        ],
      }),
    ).toMatchObject({ kind: "stock", title: expect.stringContaining("3 st") });
  });

  it("turns audit entries into sentences without echoing unknown metadata", () => {
    const secretish = {
      email: "kund@example.com",
      token: "abc123",
      customerName: "Kim Kund",
    };
    const cases: Array<[string, Record<string, unknown>, string]> = [
      [
        "UPDATE_ORDER_STATUS",
        {
          from: "PROCESSING",
          to: "SHIPPED",
          trackingNumber: "RR1SE",
          shippingCarrier: "POSTNORD",
        },
        "Leveransstatus ändrad: Behandlas → Skickad (PostNord, spårningsnummer RR1SE).",
      ],
      [
        "UPDATE_ORDER_STATUS",
        { from: "NEW", to: "PROCESSING" },
        "Leveransstatus ändrad: Ny → Behandlas.",
      ],
      [
        "UPDATE_ORDER_TRACKING",
        {
          from: { trackingNumber: null, shippingCarrier: "POSTNORD" },
          to: { trackingNumber: "RR2SE", shippingCarrier: "OTHER" },
        },
        "Spårningsuppgifter ändrade: PostNord → Annat fraktbolag, spårningsnummer RR2SE.",
      ],
      [
        "SYNC_ORDER_REFUND",
        { from: "PAID", to: "PARTIALLY_REFUNDED", refundedAmount: 4_900 },
        "Återbetalning synkad från Stripe: Betald → Delvis återbetald, totalt återbetalt 49,00 kr.",
      ],
      [
        "MARK_ORDER_PAID",
        { source: "reconciliation" },
        "Betalningen bekräftades av Stripe (vid avstämning).",
      ],
      [
        "RESOLVE_ORDER_ATTENTION",
        { kind: "email", attentionId: "x" },
        "Markerat som hanterat (e-post).",
      ],
      ["SOMETHING_NEW", {}, "Händelse: SOMETHING_NEW"],
    ];
    for (const [action, metadata, expected] of cases) {
      const text = describeOrderEvent(action, { ...metadata, ...secretish });
      // sv-SE currency formatting uses non-breaking spaces.
      expect(text.replace(/\s/g, " ")).toBe(expected);
      expect(text).not.toContain("kund@example.com");
      expect(text).not.toContain("abc123");
      expect(text).not.toContain("Kim Kund");
    }
    // Malformed metadata never throws.
    expect(describeOrderEvent("UPDATE_ORDER_STATUS", "garbage")).toBe(
      "Leveransstatus ändrad: okänd → okänd.",
    );
  });

  it("records payment rechecks with Stripe's outcome", () => {
    expect(
      describeOrderEvent("RECHECK_ORDER_PAYMENT", { outcome: "unavailable" }),
    ).toBe(
      "Betalningen kontrollerades med Stripe igen: Stripe kunde inte nås, lagret är kvar reserverat.",
    );
    expect(describeOrderEvent("RECHECK_ORDER_PAYMENT", { outcome: "x" })).toBe(
      "Betalningen kontrollerades med Stripe igen: ingen ändring.",
    );
  });
});

describe("Stripe Dashboard links", () => {
  it("links the payment in test or live mode by the configured key", () => {
    expect(stripePaymentUrl("pi_123", false)).toBe(
      "https://dashboard.stripe.com/test/payments/pi_123",
    );
    expect(stripePaymentUrl("pi_123", true)).toBe(
      "https://dashboard.stripe.com/payments/pi_123",
    );
    expect(stripePaymentUrl(null, true)).toBeNull();
    expect(stripePaymentUrl("pi_1/../../x", true)).toBeNull();
    expect(stripePaymentUrl("cs_test_1", true)).toBeNull();

    const config = (secretKey: string | null) => ({
      gateway: "stripe" as const,
      secretKey,
      webhookSecret: null,
    });
    expect(stripeDashboardIsLive(config("sk_live_x"))).toBe(true);
    expect(stripeDashboardIsLive(config("rk_live_x"))).toBe(true);
    expect(stripeDashboardIsLive(config("sk_test_x"))).toBe(false);
    expect(stripeDashboardIsLive(config(null))).toBe(false);
    expect(
      stripeDashboardIsLive({
        gateway: "fake",
        stateDir: null,
        webhookSecret: null,
      }),
    ).toBe(false);
  });
});

describe("store settings revalidation targets", () => {
  it("refreshes the whole store for footer and stock-label settings", () => {
    for (const field of [
      "contactEmail",
      "companyName",
      "organizationNumber",
      "lowStockThreshold",
    ]) {
      expect(storeSettingsRevalidationTargets([field])).toEqual([
        { path: "/", type: "layout" },
      ]);
    }
  });

  it("refreshes only the homepage for its SEO texts", () => {
    expect(storeSettingsRevalidationTargets(["defaultSeoTitle"])).toEqual([
      { path: "/" },
    ]);
  });

  it("refreshes nothing for values only checkout and emails read", () => {
    expect(
      storeSettingsRevalidationTargets([
        "storeName",
        "shippingPriceAmount",
        "freeShippingThresholdAmount",
        "defaultShippingCarrier",
        "vatRateBasisPoints",
      ]),
    ).toEqual([]);
  });
});
