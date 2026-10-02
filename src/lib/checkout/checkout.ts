import { cartConflictMessages, type CartConflict } from "@/lib/cart/cart";
import {
  unavailableMessages,
  type UnavailableReason,
} from "@/lib/cart/evaluate";
import { formatPrice } from "@/lib/money";

/*
 * Checkout request/response contract between the cart drawer and
 * POST /api/checkout. Isomorphic: the browser builds requests and renders
 * failures with it; the server validates requests with ./request-schema.ts.
 *
 * The browser sends only intent (product IDs and quantities), the prices it
 * displayed (`expectedUnitPriceAmount`) and a random attempt ID. The server
 * never charges a browser-supplied price: it compares the displayed price
 * with the current one and refuses the checkout if they differ, so the
 * customer never pays an amount they were not shown.
 */

// The request schema lives in ./request-schema.ts, which only the server
// imports: Zod would otherwise ship in every storefront page's bundle.
export type { CheckoutLineRequest, CheckoutRequest } from "./request-schema";

/** Why one cart line cannot be checked out as requested. */
export type CheckoutIssue =
  | { productId: string; kind: "unavailable"; reason: UnavailableReason }
  | {
      productId: string;
      kind: "insufficient_quantity";
      availableQuantity: number;
    }
  | {
      productId: string;
      kind: "price_changed";
      unitPriceAmount: number;
      expectedUnitPriceAmount: number;
    };

export type CheckoutFailureCode =
  /** The cart must change first; see `issues` and `conflict`. */
  | "rejected"
  /** This attempt can no longer be used; start a new one. */
  | "attempt_closed"
  | "rate_limited"
  | "invalid_request"
  /** Stripe or the store configuration is unavailable. */
  | "payment_unavailable"
  /** Too much contention right now; retrying shortly is safe. */
  | "busy"
  /**
   * This client already holds as much unpaid stock as one client may
   * (open checkouts or units); see `limit`.
   */
  | "hold_limit";

export type CheckoutResponse =
  | { ok: true; url: string }
  | {
      ok: false;
      code: "rejected";
      issues: CheckoutIssue[];
      conflict: CartConflict | null;
    }
  | {
      ok: false;
      code: "hold_limit";
      limit: "checkouts" | "units";
      /** Most units one client may hold in open checkouts. */
      maxUnits: number;
    }
  | {
      ok: false;
      code: Exclude<CheckoutFailureCode, "rejected" | "hold_limit">;
    };

export type CheckoutFailure = Extract<CheckoutResponse, { ok: false }>;

/** Stripe Hosted Checkout lives on this origin only. */
export const STRIPE_CHECKOUT_ORIGIN = "https://checkout.stripe.com";

/**
 * The browser follows a checkout URL only if it points at Stripe Hosted
 * Checkout over HTTPS, so a tampered or buggy response can never turn the
 * checkout button into an open redirect.
 */
export function isStripeCheckoutUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.origin === STRIPE_CHECKOUT_ORIGIN &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

export const GENERIC_CHECKOUT_ERROR =
  "Det gick inte att starta betalningen. Försök igen.";

export type CheckoutFailureMessage = { title: string; details: string[] };

/**
 * Swedish explanation of a failed checkout. `nameOf` returns the product
 * name currently shown in the cart (or null when unknown).
 */
export function checkoutFailureMessage(
  failure: CheckoutFailure,
  nameOf: (productId: string) => string | null,
): CheckoutFailureMessage {
  switch (failure.code) {
    case "rejected":
      return rejectionMessage(failure, nameOf);
    case "hold_limit":
      return {
        title:
          failure.limit === "checkouts"
            ? "Det finns redan flera påbörjade betalningar från din anslutning. Slutför eller avbryt dem, eller försök igen om en stund."
            : `Pågående betalningar kan som mest omfatta ${failure.maxUnits} artiklar åt gången. Minska antalet i kundvagnen eller slutför en påbörjad betalning först.`,
        details: [],
      };
    case "rate_limited":
      return {
        title:
          "Du har gjort många försök på kort tid. Vänta några minuter och försök igen.",
        details: [],
      };
    default:
      return { title: GENERIC_CHECKOUT_ERROR, details: [] };
  }
}

function rejectionMessage(
  failure: Extract<CheckoutFailure, { code: "rejected" }>,
  nameOf: (productId: string) => string | null,
): CheckoutFailureMessage {
  const details = failure.issues.map((issue) => {
    const name = nameOf(issue.productId) ?? "En produkt";
    switch (issue.kind) {
      case "unavailable":
        return `${name}: ${unavailableMessages[issue.reason]}`;
      case "insufficient_quantity":
        return issue.availableQuantity === 0
          ? `${name}: Produkten finns inte längre i lager.`
          : `${name}: Det valda antalet finns inte tillgängligt. Det finns ${issue.availableQuantity} kvar.`;
      case "price_changed":
        return `${name}: Priset har ändrats från ${formatPrice(issue.expectedUnitPriceAmount)} till ${formatPrice(issue.unitPriceAmount)}.`;
    }
  });
  if (failure.conflict) details.push(cartConflictMessages[failure.conflict]);

  return {
    title:
      "Kundvagnen har ändrats. Kontrollera den och tryck på Till kassan igen.",
    details,
  };
}
