import type { ReservationStatus } from "@/generated/prisma/enums";

/**
 * Inventory model (see docs/database.md → "Inventory reservations"):
 *
 *   availableToSell = stockOnHand − Σ quantity of holding reservations
 *
 * An ACTIVE reservation holds stock
 *
 * - while it is **awaiting payment** (attached to a Stripe Checkout Session the
 *   customer can pay), whatever its expiresAt: only Stripe's answer (paid →
 *   CONSUMED; expired or failed → RELEASED) ends the hold, applied by a
 *   webhook or by reconciliation. A clock passing expiresAt must never free
 *   units Stripe may already have been paid for (Milestone 9). Its expiresAt
 *   is then only the time reconciliation should ask Stripe;
 * - otherwise (a provisional hold whose payment page was never handed out)
 *   only until expiresAt, so a crashed checkout never blocks stock.
 *
 * CONSUMED and RELEASED reservations never hold.
 *
 * This function defines the rule. Checkout (Milestone 8) evaluates the same
 * rule in SQL inside a transaction that locks the product rows, so concurrent
 * checkouts cannot both reserve the last unit.
 */

export type ReservationLike = {
  quantity: number;
  status: ReservationStatus;
  expiresAt: Date;
  awaitingPayment: boolean;
};

export function isReservationHolding(
  reservation: ReservationLike,
  now: Date,
): boolean {
  return (
    reservation.status === "ACTIVE" &&
    (reservation.awaitingPayment ||
      reservation.expiresAt.getTime() > now.getTime())
  );
}

export function reservedQuantity(
  reservations: readonly ReservationLike[],
  now: Date,
): number {
  return reservations
    .filter((reservation) => isReservationHolding(reservation, now))
    .reduce((sum, reservation) => sum + reservation.quantity, 0);
}

/**
 * Never negative: if stock was reduced below the reserved quantity (e.g. an
 * admin corrected a miscount), the product is simply unavailable.
 */
export function availableToSell(
  stockOnHand: number,
  reservations: readonly ReservationLike[],
  now: Date,
): number {
  return Math.max(0, stockOnHand - reservedQuantity(reservations, now));
}
