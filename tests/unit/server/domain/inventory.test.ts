import { describe, expect, it } from "vitest";

import {
  availableToSell,
  isReservationHolding,
  type ReservationLike,
} from "@/server/domain/inventory";

const now = new Date("2026-09-30T12:00:00Z");
const inMinutes = (minutes: number) =>
  new Date(now.getTime() + minutes * 60_000);

const reservation = (
  overrides: Partial<ReservationLike> = {},
): ReservationLike => ({
  quantity: 1,
  status: "ACTIVE",
  expiresAt: inMinutes(30),
  awaitingPayment: false,
  ...overrides,
});

describe("isReservationHolding", () => {
  it("holds a provisional reservation while ACTIVE and unexpired", () => {
    expect(isReservationHolding(reservation(), now)).toBe(true);
  });

  it("stops holding a provisional reservation at the expiry instant even if cleanup has not run", () => {
    expect(isReservationHolding(reservation({ expiresAt: now }), now)).toBe(
      false,
    );
    expect(
      isReservationHolding(reservation({ expiresAt: inMinutes(-1) }), now),
    ).toBe(false);
  });

  it("keeps holding a reservation awaiting payment after expiresAt", () => {
    // Stripe may have accepted the payment; only its outcome ends the hold.
    expect(
      isReservationHolding(
        reservation({ awaitingPayment: true, expiresAt: inMinutes(-600) }),
        now,
      ),
    ).toBe(true);
  });

  it.each(["CONSUMED", "RELEASED"] as const)(
    "does not hold stock when %s, even if it was awaiting payment",
    (status) => {
      expect(
        isReservationHolding(
          reservation({ status, awaitingPayment: true }),
          now,
        ),
      ).toBe(false);
    },
  );

  it.each(["CONSUMED", "RELEASED"] as const)(
    "does not hold stock when %s",
    (status) => {
      expect(isReservationHolding(reservation({ status }), now)).toBe(false);
    },
  );
});

describe("availableToSell", () => {
  it("equals stock on hand without reservations", () => {
    expect(availableToSell(10, [], now)).toBe(10);
  });

  it("subtracts only holding reservations", () => {
    const reservations = [
      reservation({ quantity: 2 }),
      reservation({ quantity: 3, status: "CONSUMED" }),
      reservation({ quantity: 4, status: "RELEASED" }),
      reservation({ quantity: 5, expiresAt: inMinutes(-5) }),
      reservation({
        quantity: 1,
        expiresAt: inMinutes(-5),
        awaitingPayment: true,
      }),
    ];

    expect(availableToSell(10, reservations, now)).toBe(7);
  });

  it("reports the last unit as unavailable once reserved", () => {
    expect(availableToSell(1, [reservation()], now)).toBe(0);
  });

  it("never goes negative when stock was corrected below reservations", () => {
    expect(availableToSell(1, [reservation({ quantity: 3 })], now)).toBe(0);
  });
});
