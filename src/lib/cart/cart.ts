import { z } from "zod";

import type { IsoDate } from "@/lib/dates";

/*
 * Guest cart domain (isomorphic, pure). The browser cart only records intent:
 * which products and how many. Prices, stock, status and totals always come
 * from the server (PROJECT.md §22); see ./evaluate.ts for how a cart is
 * checked against server data.
 */

/** Technical ceiling per line; real limits come from current availability. */
export const MAX_LINE_QUANTITY = 99;
/** Bounds storage and validation requests. */
export const MAX_CART_LINES = 50;

export type CartLine = Readonly<{ productId: string; quantity: number }>;
export type Cart = Readonly<{ lines: readonly CartLine[] }>;

export const emptyCart: Cart = { lines: [] };

export function totalQuantity(cart: Cart): number {
  return cart.lines.reduce((sum, line) => sum + line.quantity, 0);
}

export function lineQuantity(cart: Cart, productId: string): number {
  return cart.lines.find((line) => line.productId === productId)?.quantity ?? 0;
}

const clampQuantity = (quantity: number, max: number) =>
  Math.max(0, Math.min(Math.floor(quantity), max, MAX_LINE_QUANTITY));

/**
 * Adds units, never exceeding `maxQuantity` for the line in total. Returns
 * how many units were actually added (0 when the line is already at max).
 */
export function addToCart(
  cart: Cart,
  productId: string,
  quantity: number,
  maxQuantity: number,
): { cart: Cart; added: number } {
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { cart, added: 0 };
  }
  const current = lineQuantity(cart, productId);
  const next = clampQuantity(current + quantity, maxQuantity);
  const added = Math.max(0, next - current);
  if (added === 0) {
    return { cart, added: 0 };
  }
  if (current === 0 && cart.lines.length >= MAX_CART_LINES) {
    return { cart, added: 0 };
  }
  return {
    cart: {
      lines:
        current === 0
          ? [...cart.lines, { productId, quantity: next }]
          : cart.lines.map((line) =>
              line.productId === productId
                ? { productId, quantity: next }
                : line,
            ),
    },
    added,
  };
}

/** Sets a line's quantity; 0 (or less) removes the line. */
export function setLineQuantity(
  cart: Cart,
  productId: string,
  quantity: number,
  maxQuantity: number = MAX_LINE_QUANTITY,
): Cart {
  const next = clampQuantity(quantity, maxQuantity);
  if (next === 0) {
    return removeFromCart(cart, productId);
  }
  return {
    lines: cart.lines.map((line) =>
      line.productId === productId ? { productId, quantity: next } : line,
    ),
  };
}

export function removeFromCart(cart: Cart, productId: string): Cart {
  return {
    lines: cart.lines.filter((line) => line.productId !== productId),
  };
}

// --- Persistence -----------------------------------------------------------------

/**
 * Stored format (localStorage), versioned so future changes can migrate or
 * discard old data safely:
 *
 *   {"v":1,"lines":[{"id":"<product uuid>","q":2}]}
 *
 * Only product IDs and quantities are stored, never prices or stock.
 */
export const CART_STORAGE_KEY = "heavycards:cart";
export const CART_STORAGE_VERSION = 1;

const storedLineSchema = z.object({
  id: z.uuid(),
  q: z.number().int().min(1),
});

const storedCartSchema = z.object({
  v: z.literal(CART_STORAGE_VERSION),
  lines: z.array(z.unknown()).max(500),
});

/**
 * Parses stored data defensively and never throws. Malformed JSON, unknown
 * versions or a wrong shape yield an empty cart; individual invalid lines are
 * dropped, duplicates merged and quantities clamped.
 */
export function parseStoredCart(raw: string | null | undefined): Cart {
  if (!raw) return emptyCart;

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return emptyCart;
  }
  const stored = storedCartSchema.safeParse(json);
  if (!stored.success) return emptyCart;

  let cart: Cart = emptyCart;
  for (const candidate of stored.data.lines) {
    const line = storedLineSchema.safeParse(candidate);
    if (!line.success) continue;
    cart = addToCart(cart, line.data.id, line.data.q, MAX_LINE_QUANTITY).cart;
  }
  return cart;
}

export function serializeCart(cart: Cart): string {
  return JSON.stringify({
    v: CART_STORAGE_VERSION,
    lines: cart.lines.map((line) => ({ id: line.productId, q: line.quantity })),
  });
}

// --- One-shipment rules (V1) -----------------------------------------------------

/**
 * How a product ships. V1 sends every order as one shipment, so a cart may
 * contain either in-stock products or preorders with one shared release date.
 * `isPreorder` decides, even after the release date has passed.
 */
export type ShipmentGroup =
  | Readonly<{ kind: "stock" }>
  | Readonly<{ kind: "preorder"; releaseDate: IsoDate | null }>;

export type CartConflict = "preorder_with_stock" | "different_release_dates";

export const cartConflictMessages: Readonly<Record<CartConflict, string>> = {
  preorder_with_stock:
    "Förbeställningar och lagerförda produkter behöver beställas separat. Slutför eller töm din kundvagn först.",
  different_release_dates:
    "Förbeställningar med olika släppdatum behöver beställas separat, eftersom varje order skickas i en leverans.",
};

/**
 * Whether two products can ship together. Preorders without a known release
 * date cannot be proven to ship together, so they only combine with
 * themselves.
 */
export function shipmentConflict(
  a: { productId: string; shipment: ShipmentGroup },
  b: { productId: string; shipment: ShipmentGroup },
): CartConflict | null {
  if (a.productId === b.productId) return null;
  if (a.shipment.kind !== b.shipment.kind) return "preorder_with_stock";
  if (a.shipment.kind === "preorder" && b.shipment.kind === "preorder") {
    const same =
      a.shipment.releaseDate !== null &&
      a.shipment.releaseDate === b.shipment.releaseDate;
    return same ? null : "different_release_dates";
  }
  return null;
}

/** First conflict between a candidate and the products already in the cart. */
export function findConflict(
  existing: ReadonlyArray<{ productId: string; shipment: ShipmentGroup }>,
  candidate: { productId: string; shipment: ShipmentGroup },
): CartConflict | null {
  for (const item of existing) {
    const conflict = shipmentConflict(item, candidate);
    if (conflict) return conflict;
  }
  return null;
}
