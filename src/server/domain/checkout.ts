import { evaluateCart, type CartProductView } from "@/lib/cart/evaluate";
import type { CartConflict } from "@/lib/cart/cart";
import type {
  CheckoutIssue,
  CheckoutLineRequest,
} from "@/lib/checkout/checkout";
import { multiplyAmount, sumAmounts, vatPortionOfGross } from "@/lib/money";

import { calculateShippingAmount, type ShippingSettings } from "./shipping";

/*
 * Authoritative checkout rules (pure). The checkout service runs these on
 * product data loaded inside its transaction, after locking the product rows
 * (src/server/checkout/create-checkout.ts).
 */

const MINUTE_MS = 60 * 1000;

/**
 * Lifetime of a Stripe Checkout Session. Stripe accepts 30 minutes to 24
 * hours (verified against the API reference, 2026-10-01). 40 minutes keeps
 * abandoned checkouts from holding stock for long while staying above
 * Stripe's minimum even if the session is created up to
 * PROVISIONAL_HOLD_MS after the order (an idempotent retry).
 */
export const CHECKOUT_SESSION_TTL_MS = 40 * MINUTE_MS;

/**
 * Reservations are created before Stripe is called and first hold stock only
 * this long. If the process dies before the Stripe session is attached, the
 * hold lapses quickly on its own. Longer than the worst-case Stripe call
 * (20 s timeout × 3 attempts).
 */
export const PROVISIONAL_HOLD_MS = 5 * MINUTE_MS;

/**
 * Once the session is attached, reservations hold until the session expires
 * plus this grace period. Stripe can complete a session right up to
 * expires_at and its webhook can arrive later; the reservation must not
 * lapse while a legitimate payment may still be in flight.
 */
export const RESERVATION_GRACE_MS = 15 * MINUTE_MS;

/**
 * A repeated submission of the same attempt reuses its open session only if
 * the customer still has a reasonable amount of time to pay.
 */
export const MIN_REUSABLE_SESSION_MS = 5 * MINUTE_MS;

/** Whole seconds: Stripe's expires_at has second precision. */
export function sessionExpiryFor(now: Date): Date {
  return new Date(
    Math.floor((now.getTime() + CHECKOUT_SESSION_TTL_MS) / 1000) * 1000,
  );
}

export function provisionalHoldUntil(now: Date): Date {
  return new Date(now.getTime() + PROVISIONAL_HOLD_MS);
}

export function reservationHoldUntil(sessionExpiresAt: Date): Date {
  return new Date(sessionExpiresAt.getTime() + RESERVATION_GRACE_MS);
}

export type CheckoutSettings = ShippingSettings & {
  vatRateBasisPoints: number;
};

export type CheckoutProduct = { view: CartProductView; sku: string | null };

export type PricedCheckoutLine = {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  unitPriceAmount: number;
  totalPriceAmount: number;
};

export type PricedCheckout = {
  lines: PricedCheckoutLine[];
  subtotalAmount: number;
  shippingAmount: number;
  /** VAT contained in totalAmount (prices are VAT-inclusive). */
  taxAmount: number;
  totalAmount: number;
  vatRateBasisPoints: number;
};

export type CheckoutEvaluation =
  | { ok: true; checkout: PricedCheckout }
  | { ok: false; issues: CheckoutIssue[]; conflict: CartConflict | null };

/**
 * Validates requested lines against current product data and prices them.
 *
 * Rejected when any line is unavailable, exceeds available-to-sell, shows a
 * price that is no longer current, or when the products cannot ship together
 * (V1 one-shipment rules: stock and preorders never mix; preorders only with
 * one identical, known release date; `isPreorder` decides even after the
 * release date). Amounts come only from `products`, never from the request.
 */
export function evaluateCheckout(
  lines: readonly CheckoutLineRequest[],
  products: ReadonlyMap<string, CheckoutProduct>,
  settings: CheckoutSettings,
): CheckoutEvaluation {
  const views: Record<string, CartProductView> = {};
  for (const line of lines) {
    views[line.productId] = products.get(line.productId)?.view ?? {
      productId: line.productId,
      available: false,
      unavailableReason: "not_found",
      name: null,
      slug: null,
      setName: null,
      image: null,
      unitPriceAmount: null,
      maxQuantity: 0,
      shipment: null,
    };
  }
  const evaluated = evaluateCart(
    {
      lines: lines.map(({ productId, quantity }) => ({ productId, quantity })),
    },
    views,
  );

  const issues: CheckoutIssue[] = [];
  const priced: PricedCheckoutLine[] = [];
  for (const [index, entry] of evaluated.lines.entries()) {
    const request = lines[index]!;
    const view = views[request.productId]!;
    const sku = products.get(request.productId)?.sku ?? null;

    if (
      entry.issue === "unavailable" ||
      view.unitPriceAmount === null ||
      view.name === null ||
      sku === null
    ) {
      issues.push({
        productId: request.productId,
        kind: "unavailable",
        reason: view.unavailableReason ?? "not_found",
      });
      continue;
    }
    if (entry.issue === "exceeds_available") {
      issues.push({
        productId: request.productId,
        kind: "insufficient_quantity",
        availableQuantity: view.maxQuantity,
      });
      continue;
    }
    if (view.unitPriceAmount !== request.expectedUnitPriceAmount) {
      issues.push({
        productId: request.productId,
        kind: "price_changed",
        unitPriceAmount: view.unitPriceAmount,
        expectedUnitPriceAmount: request.expectedUnitPriceAmount,
      });
      continue;
    }
    priced.push({
      productId: request.productId,
      name: view.name,
      sku,
      quantity: request.quantity,
      unitPriceAmount: view.unitPriceAmount,
      totalPriceAmount: multiplyAmount(view.unitPriceAmount, request.quantity),
    });
  }

  if (issues.length > 0 || evaluated.conflict) {
    return { ok: false, issues, conflict: evaluated.conflict };
  }
  return { ok: true, checkout: priceCheckout(priced, settings) };
}

/** Subtotal, flat/free shipping and contained VAT for priced lines. */
export function priceCheckout(
  lines: PricedCheckoutLine[],
  settings: CheckoutSettings,
): PricedCheckout {
  const subtotalAmount = sumAmounts(lines.map((line) => line.totalPriceAmount));
  const shippingAmount = calculateShippingAmount(subtotalAmount, settings);
  const totalAmount = sumAmounts([subtotalAmount, shippingAmount]);
  return {
    lines,
    subtotalAmount,
    shippingAmount,
    totalAmount,
    // Shipping follows the VAT rate of the goods it delivers.
    taxAmount: vatPortionOfGross(totalAmount, settings.vatRateBasisPoints),
    vatRateBasisPoints: settings.vatRateBasisPoints,
  };
}

/**
 * Whether a repeated submission asks for exactly what an existing attempt's
 * order contains: same products, quantities and (displayed) unit prices.
 */
export function matchesOrderLines(
  orderItems: ReadonlyArray<{
    productId: string;
    quantity: number;
    unitPriceAmount: number;
  }>,
  lines: readonly CheckoutLineRequest[],
): boolean {
  if (orderItems.length !== lines.length) return false;
  const requested = new Map(lines.map((line) => [line.productId, line]));
  return orderItems.every((item) => {
    const line = requested.get(item.productId);
    return (
      line !== undefined &&
      line.quantity === item.quantity &&
      line.expectedUnitPriceAmount === item.unitPriceAmount
    );
  });
}

// --- Open holds per client (Milestone 14) ------------------------------------

/*
 * A checkout reserves stock for the whole Stripe session (40 minutes plus
 * grace, PROJECT.md §26), and Stripe's own minimum session lifetime is 30
 * minutes, so time alone cannot stop someone from holding stock without
 * paying. These caps bound what one client (the HMAC of its IP address,
 * shared with rate limiting) can hold at once:
 *
 * - a customer has one open checkout per browser (a new attempt supersedes
 *   the previous one), so three leave room for a second device or a few
 *   people on one network (a household, an office, mobile carrier NAT);
 * - 30 units across those checkouts is far above a normal sealed-product
 *   order while keeping one client from reserving a whole release.
 *
 * Holds end as usual (payment, expiry, failure, superseding), which frees
 * the client's allowance again. A distributed actor with many addresses is
 * not stopped by this; see docs/production-readiness.md.
 */
export const MAX_OPEN_CHECKOUTS_PER_CLIENT = 3;
export const MAX_HELD_UNITS_PER_CLIENT = 30;

export type ClientHolds = { checkouts: number; units: number };

/** Which cap a new checkout of `requestedUnits` would exceed, if any. */
export function exceededHoldLimit(
  open: ClientHolds,
  requestedUnits: number,
): "checkouts" | "units" | null {
  if (open.checkouts >= MAX_OPEN_CHECKOUTS_PER_CLIENT) return "checkouts";
  if (open.units + requestedUnits > MAX_HELD_UNITS_PER_CLIENT) return "units";
  return null;
}
