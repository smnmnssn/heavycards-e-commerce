import { multiplyAmount, sumAmounts } from "@/lib/money";
import type { AvailabilityState } from "@/server/domain/catalog";

import {
  findConflict,
  type Cart,
  type CartConflict,
  type CartLine,
  type ShipmentGroup,
} from "./cart";

/*
 * Evaluates a browser cart against current product data from the server.
 * Pure and isomorphic: the drawer uses it for display, and checkout
 * (Milestone 8) can run the same evaluation on data loaded inside its
 * transaction, then compute the authoritative totals.
 */

export type UnavailableReason =
  | "not_found"
  | Exclude<AvailabilityState, "in_stock" | "low_stock" | "preorder">;

/** Server-provided, current view of one product in the cart. */
export type CartProductView = {
  productId: string;
  /** Purchasable right now (in stock, low stock or preorder with units). */
  available: boolean;
  unavailableReason: UnavailableReason | null;
  /** Null for products that no longer have a public page. */
  name: string | null;
  slug: string | null;
  setName: string | null;
  image: { url: string; alt: string; width: number; height: number } | null;
  unitPriceAmount: number | null;
  /** Units a customer may have in the cart now (0 when unavailable). */
  maxQuantity: number;
  shipment: ShipmentGroup | null;
};

export type CartLineIssue = "unavailable" | "exceeds_available";

export type EvaluatedLine = {
  line: CartLine;
  product: CartProductView | undefined;
  issue: CartLineIssue | null;
  /** unit price × quantity for lines that can be bought, else null. */
  lineTotalAmount: number | null;
};

export type EvaluatedCart = {
  lines: EvaluatedLine[];
  /** Display estimate of VAT-inclusive merchandise; shipping excluded. */
  subtotalAmount: number;
  conflict: CartConflict | null;
  /** Some lines still lack server data (loading or failed). */
  incomplete: boolean;
  hasIssues: boolean;
};

export const unavailableMessages: Readonly<Record<UnavailableReason, string>> =
  {
    not_found: "Produkten finns inte längre och kan inte beställas.",
    discontinued: "Produkten säljs inte längre och kan inte beställas.",
    sold_out: "Produkten är slutsåld och kan inte beställas just nu.",
    preorder_sold_out:
      "Förbeställningarna är slutsålda och produkten kan inte beställas.",
    coming_soon: "Produkten går inte att beställa ännu.",
  };

export function evaluateCart(
  cart: Cart,
  products: Readonly<Record<string, CartProductView>>,
): EvaluatedCart {
  let incomplete = false;
  const lines = cart.lines.map((line): EvaluatedLine => {
    const product = products[line.productId];
    if (!product) {
      incomplete = true;
      return { line, product, issue: null, lineTotalAmount: null };
    }
    if (!product.available || product.unitPriceAmount === null) {
      return { line, product, issue: "unavailable", lineTotalAmount: null };
    }
    return {
      line,
      product,
      issue: line.quantity > product.maxQuantity ? "exceeds_available" : null,
      lineTotalAmount: multiplyAmount(product.unitPriceAmount, line.quantity),
    };
  });

  const orderable = lines.filter((entry) => entry.issue !== "unavailable");
  const withShipment = orderable
    .map((entry) => entry.product)
    .filter(
      (product): product is CartProductView & { shipment: ShipmentGroup } =>
        Boolean(product?.shipment),
    );
  let conflict: CartConflict | null = null;
  for (const [index, product] of withShipment.entries()) {
    conflict = findConflict(withShipment.slice(0, index), product);
    if (conflict) break;
  }

  return {
    lines,
    subtotalAmount: sumAmounts(
      lines.flatMap((entry) =>
        entry.lineTotalAmount === null ? [] : [entry.lineTotalAmount],
      ),
    ),
    conflict,
    incomplete,
    hasIssues: conflict !== null || lines.some((entry) => entry.issue !== null),
  };
}
