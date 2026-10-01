import type { PaymentStatus } from "@/generated/prisma/enums";

/*
 * Payment rules (pure). Stripe is the only source of payment truth: these
 * functions interpret Stripe's *current* state of a Checkout Session or
 * payment, never the event that announced it, so duplicate, late or
 * reordered events all converge on the same result
 * (src/server/payments/session-sync.ts).
 */

// --- Allowed payment-state transitions --------------------------------------

/**
 * Every allowed change of Order.paymentStatus. Staying in the same state is
 * always allowed (a no-op). EXPIRED and FAILED are final: a checkout that
 * Stripe reported as unpayable is never revived. PAID can only move to the
 * refund states, and the refund states follow Stripe's refunded amount in
 * both directions (a failed or cancelled refund lowers it again), but never
 * back to an unpaid state.
 */
export const PAYMENT_TRANSITIONS: Readonly<
  Record<PaymentStatus, readonly PaymentStatus[]>
> = {
  PENDING: ["PAID", "EXPIRED", "FAILED"],
  PAID: ["PARTIALLY_REFUNDED", "REFUNDED"],
  PARTIALLY_REFUNDED: ["PAID", "REFUNDED"],
  REFUNDED: ["PAID", "PARTIALLY_REFUNDED"],
  EXPIRED: [],
  FAILED: [],
};

export function canTransitionPayment(
  from: PaymentStatus,
  to: PaymentStatus,
): boolean {
  return from === to || PAYMENT_TRANSITIONS[from].includes(to);
}

/** States in which Stripe has taken the customer's money. */
export function isPaidState(status: PaymentStatus): boolean {
  return (
    status === "PAID" ||
    status === "PARTIALLY_REFUNDED" ||
    status === "REFUNDED"
  );
}

// --- Checkout Session state ----------------------------------------------------

/** What HeavyCards needs from a Stripe Checkout Session (provider-neutral). */
export type CheckoutSessionState = {
  id: string;
  /** Stripe: open | complete | expired (anything else is treated as unknown). */
  status: string | null;
  /** Stripe: paid | unpaid | no_payment_required. */
  paymentStatus: string;
  /** Authoritative charged amount in öre. */
  amountTotal: number | null;
  /** Lowercase ISO code. */
  currency: string | null;
  paymentIntent: {
    id: string;
    /** Stripe PaymentIntent status, e.g. succeeded, processing. */
    status: string;
    /** When the successful charge was created, if known. */
    paidAt: Date | null;
  } | null;
  customer: {
    /** Full name entered with the shipping address (one value). */
    shippingName: string | null;
    /** Name from the customer details, used only if no shipping name. */
    name: string | null;
    email: string | null;
    phone: string | null;
  };
  shippingAddress: {
    line1: string | null;
    line2: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
  } | null;
};

export type SessionOutcome =
  /** Stripe confirmed the payment. */
  | "paid"
  /** Completed with a delayed payment method that has not settled yet. */
  | "processing"
  /** A delayed payment failed: the order will not be paid. */
  | "failed"
  /** The session expired unpaid: it can no longer be paid. */
  | "expired"
  /** Still open: the customer may still pay. */
  | "open"
  /** A state HeavyCards does not expect; nothing is changed. */
  | "unknown";

const PAYMENT_INTENT_PROCESSING = new Set([
  "processing",
  "requires_action",
  "requires_confirmation",
  "requires_capture",
]);
const PAYMENT_INTENT_FAILED = new Set(["requires_payment_method", "canceled"]);

/**
 * Classifies a session following Stripe's Checkout fulfilment model:
 * `status: complete` + `payment_status: paid` is a confirmed payment; a
 * complete but unpaid session is waiting for a delayed payment method whose
 * PaymentIntent either settles (succeeded) or fails (back to
 * requires_payment_method, or canceled); `status: expired` can never be paid.
 * HeavyCards orders always cost more than 0, so `no_payment_required` is
 * unexpected.
 */
export function classifySession(state: CheckoutSessionState): SessionOutcome {
  switch (state.status) {
    case "expired":
      return state.paymentStatus === "paid" ? "unknown" : "expired";
    case "open":
      return "open";
    case "complete":
      break;
    default:
      return "unknown";
  }
  if (state.paymentStatus === "paid") return "paid";
  if (state.paymentStatus !== "unpaid") return "unknown";
  const intent = state.paymentIntent?.status;
  if (intent && PAYMENT_INTENT_FAILED.has(intent)) return "failed";
  if (intent && PAYMENT_INTENT_PROCESSING.has(intent)) return "processing";
  return "unknown";
}

/** Stripe's charged amount and currency must equal the order's exactly. */
export function amountMismatch(
  state: Pick<CheckoutSessionState, "amountTotal" | "currency">,
  order: { totalAmount: number; currency: "SEK" },
): "amount" | "currency" | null {
  if (state.currency !== order.currency.toLowerCase()) return "currency";
  if (state.amountTotal !== order.totalAmount) return "amount";
  return null;
}

// --- Customer and fulfilment details --------------------------------------------

export type FulfillmentDetails = {
  customerName: string;
  email: string;
  phone: string | null;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string;
  city: string;
  country: "SE";
};

export type FulfillmentProblem =
  | "customer_name"
  | "email"
  | "phone"
  | "address_line1"
  | "address_line2"
  | "postal_code"
  | "city"
  | "country";

/** Column limits (docs/database.md); longer values are never truncated. */
const LIMITS = {
  customerName: 200,
  email: 320,
  phone: 40,
  addressLine: 200,
  postalCode: 20,
  city: 100,
} as const;

const clean = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/**
 * The details a paid order must carry, taken only from the verified Stripe
 * session. The name is the single full name Stripe collected with the
 * shipping address, kept exactly as entered apart from surrounding
 * whitespace; it is never split. Returns the problems instead when a
 * required value is missing, too long or outside Sweden, so the order is
 * never marked paid with incomplete data.
 */
export function fulfillmentDetails(
  state: Pick<CheckoutSessionState, "customer" | "shippingAddress">,
):
  | { ok: true; details: FulfillmentDetails }
  | { ok: false; problems: FulfillmentProblem[] } {
  const problems: FulfillmentProblem[] = [];
  const name = clean(state.customer.shippingName) ?? clean(state.customer.name);
  const email = clean(state.customer.email);
  const phone = clean(state.customer.phone);
  const address = state.shippingAddress;
  const line1 = clean(address?.line1);
  const line2 = clean(address?.line2);
  const postalCode = clean(address?.postalCode);
  const city = clean(address?.city);

  const required = (
    value: string | null,
    max: number,
    problem: FulfillmentProblem,
  ) => {
    if (!value || value.length > max) problems.push(problem);
  };
  required(name, LIMITS.customerName, "customer_name");
  required(email, LIMITS.email, "email");
  if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) problems.push("email");
  required(line1, LIMITS.addressLine, "address_line1");
  required(postalCode, LIMITS.postalCode, "postal_code");
  required(city, LIMITS.city, "city");
  if (phone && phone.length > LIMITS.phone) problems.push("phone");
  if (line2 && line2.length > LIMITS.addressLine)
    problems.push("address_line2");
  // Checkout only offers Sweden; anything else is not shipped.
  if (address?.country !== "SE") problems.push("country");

  if (problems.length > 0)
    return { ok: false, problems: [...new Set(problems)] };
  return {
    ok: true,
    details: {
      customerName: name!,
      email: email!,
      phone,
      addressLine1: line1!,
      addressLine2: line2,
      postalCode: postalCode!,
      city: city!,
      country: "SE",
    },
  };
}

// --- Refunds ----------------------------------------------------------------------

export type RefundLike = {
  amount: number;
  status: string | null;
  currency: string;
};

/**
 * The amount HeavyCards records as refunded: only refunds Stripe reports as
 * `succeeded`. A `pending` or `requires_action` refund has not returned the
 * money yet and may still fail or be cancelled, so it counts only once a
 * later event reports it succeeded; `failed` and `canceled` refunds never
 * count. The order's refund status therefore never runs ahead of money
 * actually returned.
 */
export function succeededRefundTotal(refunds: Iterable<RefundLike>): {
  amountRefunded: number;
  currency: string;
} {
  let amountRefunded = 0;
  let currency = "sek";
  for (const refund of refunds) {
    if (refund.status !== "succeeded") continue;
    amountRefunded += refund.amount;
    currency = refund.currency;
  }
  return { amountRefunded, currency };
}

/**
 * Payment state for the successfully refunded amount. Nothing refunded is
 * PAID, everything is REFUNDED, anything in between PARTIALLY_REFUNDED.
 */
export function refundState(
  totalAmount: number,
  refundedAmount: number,
): "PAID" | "PARTIALLY_REFUNDED" | "REFUNDED" {
  if (refundedAmount <= 0) return "PAID";
  if (refundedAmount >= totalAmount) return "REFUNDED";
  return "PARTIALLY_REFUNDED";
}
