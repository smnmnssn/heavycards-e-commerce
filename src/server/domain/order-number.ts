/**
 * Public order numbers ("HC-10001").
 *
 * The numeric part is allocated by the PostgreSQL sequence behind
 * `orders.order_number` (starting at 10001), which is atomic under concurrent
 * checkouts, so application code never computes "max + 1". These helpers only
 * format and parse. Order numbers identify an order to humans; they must never
 * be used to authorize access to it.
 */

export const ORDER_NUMBER_PREFIX = "HC-";
export const FIRST_ORDER_NUMBER = 10_001;

export function formatOrderNumber(orderNumber: number): string {
  if (!Number.isSafeInteger(orderNumber) || orderNumber < FIRST_ORDER_NUMBER) {
    throw new RangeError("Invalid order number");
  }
  return `${ORDER_NUMBER_PREFIX}${orderNumber}`;
}

/**
 * Parses admin/customer input such as "HC-10001", "hc 10001" or "10001".
 * Returns null for anything that is not a plausible order number.
 */
export function parseOrderNumber(input: string): number | null {
  const match = /^(?:hc[-\s]?)?(\d{5,9})$/i.exec(input.trim());
  if (!match?.[1]) {
    return null;
  }
  const value = Number(match[1]);
  return value >= FIRST_ORDER_NUMBER ? value : null;
}
