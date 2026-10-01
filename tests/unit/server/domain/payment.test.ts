import { describe, expect, it } from "vitest";

import type { PaymentStatus } from "@/generated/prisma/enums";
import {
  amountMismatch,
  canTransitionPayment,
  classifySession,
  fulfillmentDetails,
  isPaidState,
  PAYMENT_TRANSITIONS,
  refundState,
  succeededRefundTotal,
  type CheckoutSessionState,
} from "@/server/domain/payment";

const STATES = Object.keys(PAYMENT_TRANSITIONS) as PaymentStatus[];

describe("payment-state transitions", () => {
  it.each([
    ["PENDING", "PAID"],
    ["PENDING", "EXPIRED"],
    ["PENDING", "FAILED"],
    ["PAID", "PARTIALLY_REFUNDED"],
    ["PAID", "REFUNDED"],
    ["PARTIALLY_REFUNDED", "REFUNDED"],
    ["PARTIALLY_REFUNDED", "PAID"], // a refund failed
    ["REFUNDED", "PARTIALLY_REFUNDED"], // part of a refund failed
  ] as const)("allows %s → %s", (from, to) => {
    expect(canTransitionPayment(from, to)).toBe(true);
  });

  it.each([
    ["PAID", "EXPIRED"], // late expiry event
    ["PAID", "PENDING"],
    ["PAID", "FAILED"],
    ["REFUNDED", "EXPIRED"],
    ["EXPIRED", "PAID"],
    ["FAILED", "PAID"],
    ["EXPIRED", "PENDING"],
    ["PARTIALLY_REFUNDED", "PENDING"],
  ] as const)("refuses %s → %s", (from, to) => {
    expect(canTransitionPayment(from, to)).toBe(false);
  });

  it("always allows staying in the same state and never leaves a final state", () => {
    for (const state of STATES) {
      expect(canTransitionPayment(state, state)).toBe(true);
    }
    expect(PAYMENT_TRANSITIONS.EXPIRED).toEqual([]);
    expect(PAYMENT_TRANSITIONS.FAILED).toEqual([]);
  });

  it("paid states never lead back to an unpaid state", () => {
    for (const from of STATES.filter(isPaidState)) {
      for (const to of PAYMENT_TRANSITIONS[from]) {
        expect(isPaidState(to)).toBe(true);
      }
    }
  });
});

const session = (
  overrides: Partial<CheckoutSessionState> = {},
): CheckoutSessionState => ({
  id: "cs_test_1",
  status: "complete",
  paymentStatus: "paid",
  amountTotal: 10_000,
  currency: "sek",
  paymentIntent: { id: "pi_1", status: "succeeded", paidAt: null },
  customer: {
    shippingName: "Kim Kund",
    name: "Kim Kund",
    email: "kim@example.com",
    phone: null,
  },
  shippingAddress: {
    line1: "Gatan 1",
    line2: null,
    postalCode: "111 22",
    city: "Stockholm",
    country: "SE",
  },
  ...overrides,
});

describe("classifySession", () => {
  it.each([
    ["complete + paid", {}, "paid"],
    ["open", { status: "open", paymentStatus: "unpaid" }, "open"],
    [
      "expired + unpaid",
      { status: "expired", paymentStatus: "unpaid" },
      "expired",
    ],
    [
      "delayed payment processing",
      {
        paymentStatus: "unpaid",
        paymentIntent: { id: "pi", status: "processing", paidAt: null },
      },
      "processing",
    ],
    [
      "delayed payment failed",
      {
        paymentStatus: "unpaid",
        paymentIntent: {
          id: "pi",
          status: "requires_payment_method",
          paidAt: null,
        },
      },
      "failed",
    ],
    [
      "payment cancelled",
      {
        paymentStatus: "unpaid",
        paymentIntent: { id: "pi", status: "canceled", paidAt: null },
      },
      "failed",
    ],
    [
      "no payment required",
      { paymentStatus: "no_payment_required" },
      "unknown",
    ],
    [
      "expired but paid",
      { status: "expired", paymentStatus: "paid" },
      "unknown",
    ],
    ["unknown status", { status: "something_new" }, "unknown"],
    [
      "complete, unpaid, no payment",
      { paymentStatus: "unpaid", paymentIntent: null },
      "unknown",
    ],
  ] as const)("%s → %s", (_label, overrides, expected) => {
    expect(
      classifySession(session(overrides as Partial<CheckoutSessionState>)),
    ).toBe(expected);
  });
});

describe("amountMismatch", () => {
  const order = { totalAmount: 10_000, currency: "SEK" as const };
  it("requires the exact amount in SEK", () => {
    expect(amountMismatch(session(), order)).toBeNull();
    expect(amountMismatch(session({ amountTotal: 9_999 }), order)).toBe(
      "amount",
    );
    expect(amountMismatch(session({ amountTotal: null }), order)).toBe(
      "amount",
    );
    expect(amountMismatch(session({ currency: "eur" }), order)).toBe(
      "currency",
    );
    expect(amountMismatch(session({ currency: null }), order)).toBe("currency");
  });
});

describe("fulfillmentDetails", () => {
  it("keeps the single full name as entered and never splits it", () => {
    const result = fulfillmentDetails(
      session({
        customer: {
          shippingName: "  Maria José de la Cruz Andersson  ",
          name: "Billing Name",
          email: " maria@example.com ",
          phone: "+46 70 123 45 67",
        },
      }),
    );
    expect(result).toEqual({
      ok: true,
      details: {
        customerName: "Maria José de la Cruz Andersson",
        email: "maria@example.com",
        phone: "+46 70 123 45 67",
        addressLine1: "Gatan 1",
        addressLine2: null,
        postalCode: "111 22",
        city: "Stockholm",
        country: "SE",
      },
    });
  });

  it("falls back to the customer name only when no shipping name exists", () => {
    const result = fulfillmentDetails(
      session({
        customer: { ...session().customer, shippingName: null, name: "Cher" },
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      details: { customerName: "Cher" },
    });
  });

  it.each([
    [
      "no name",
      { customer: { ...session().customer, shippingName: " ", name: null } },
      "customer_name",
    ],
    ["no email", { customer: { ...session().customer, email: null } }, "email"],
    [
      "an invalid email",
      { customer: { ...session().customer, email: "nope" } },
      "email",
    ],
    ["no address", { shippingAddress: null }, "address_line1"],
    [
      "no city",
      { shippingAddress: { ...session().shippingAddress!, city: null } },
      "city",
    ],
    [
      "no postal code",
      { shippingAddress: { ...session().shippingAddress!, postalCode: "" } },
      "postal_code",
    ],
    [
      "another country",
      { shippingAddress: { ...session().shippingAddress!, country: "NO" } },
      "country",
    ],
    [
      "a name too long to store",
      { customer: { ...session().customer, shippingName: "x".repeat(201) } },
      "customer_name",
    ],
    [
      "a phone too long to store",
      { customer: { ...session().customer, phone: "1".repeat(41) } },
      "phone",
    ],
  ] as const)(
    "reports %s instead of truncating or guessing",
    (_label, overrides, problem) => {
      const result = fulfillmentDetails(
        session(overrides as Partial<CheckoutSessionState>),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.problems).toContain(problem);
    },
  );
});

describe("refundState", () => {
  it.each([
    [0, "PAID"],
    [1, "PARTIALLY_REFUNDED"],
    [9_999, "PARTIALLY_REFUNDED"],
    [10_000, "REFUNDED"],
  ] as const)("%i of 10 000 öre refunded → %s", (refunded, expected) => {
    expect(refundState(10_000, refunded)).toBe(expected);
  });
});

describe("succeededRefundTotal", () => {
  const refund = (amount: number, status: string | null) => ({
    amount,
    status,
    currency: "sek",
  });

  it("counts succeeded refunds only", () => {
    expect(
      succeededRefundTotal([
        refund(5_000, "succeeded"),
        refund(1_000, "succeeded"),
        refund(7_000, "pending"),
        refund(3_000, "requires_action"),
        refund(2_000, "failed"),
        refund(4_000, "canceled"),
        refund(9_000, null),
      ]),
    ).toEqual({ amountRefunded: 6_000, currency: "sek" });
  });

  it.each(["pending", "requires_action", "failed", "canceled"])(
    "a refund that is only %s counts as nothing refunded",
    (status) => {
      const total = succeededRefundTotal([refund(10_000, status)]);
      expect(total.amountRefunded).toBe(0);
      expect(refundState(10_000, total.amountRefunded)).toBe("PAID");
    },
  );

  it("is zero without refunds", () => {
    expect(succeededRefundTotal([])).toEqual({
      amountRefunded: 0,
      currency: "sek",
    });
  });
});
