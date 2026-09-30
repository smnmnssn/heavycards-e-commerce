import type { ReservationStatus } from "@/generated/prisma/enums";

/**
 * Inventory model (see docs/database.md → "Inventory reservations"):
 *
 *   availableToSell = stockOnHand − Σ quantity of holding reservations
 *
 * A reservation holds stock only while it is ACTIVE *and* unexpired. Treating
 * expired-but-unreleased reservations as non-holding means a missed webhook or
 * a failed cleanup run can never block inventory permanently; cleanup merely
 * tidies the status afterwards.
 *
 * This function defines the rule. Checkout (Milestone 8) evaluates the same
 * rule in SQL inside a transaction that locks the product rows, so concurrent
 * checkouts cannot both reserve the last unit.
 */

export type ReservationLike = {
  quantity: number;
  status: ReservationStatus;
  expiresAt: Date;
};

export function isReservationHolding(
  reservation: ReservationLike,
  now: Date,
): boolean {
  return (
    reservation.status === "ACTIVE" &&
    reservation.expiresAt.getTime() > now.getTime()
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
