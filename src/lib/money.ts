/**
 * Money is always an integer number of minor units (öre): 149900 = 1 499,00 kr.
 * Floating-point values are never a source of truth for money.
 *
 * Amount columns are PostgreSQL `integer`, so a single stored amount is capped
 * at MAX_AMOUNT (≈ 21.4 million kr). Aggregates must be computed in SQL or
 * with BigInt, not stored in these columns.
 *
 * This module is isomorphic (safe for client components) so display code and
 * server calculations share one implementation.
 */

export const MAX_AMOUNT = 2_147_483_647;

export class InvalidAmountError extends Error {
  constructor(label: string) {
    super(`${label} must be an integer amount in minor units within range`);
    this.name = "InvalidAmountError";
  }
}

export function isValidAmount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_AMOUNT
  );
}

export function assertValidAmount(
  value: unknown,
  label = "amount",
): asserts value is number {
  if (!isValidAmount(value)) {
    throw new InvalidAmountError(label);
  }
}

/** unitAmount × quantity, rejecting overflow instead of silently losing precision. */
export function multiplyAmount(unitAmount: number, quantity: number): number {
  assertValidAmount(unitAmount, "unitAmount");
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new InvalidAmountError("quantity");
  }
  const total = unitAmount * quantity;
  assertValidAmount(total, "total");
  return total;
}

export function sumAmounts(amounts: readonly number[]): number {
  let total = 0;
  for (const amount of amounts) {
    assertValidAmount(amount);
    total += amount;
  }
  assertValidAmount(total, "sum");
  return total;
}

/**
 * VAT contained in a VAT-inclusive (gross) amount, rounded half-up to whole
 * öre. The rate is given in basis points (2500 = 25 %) so no percentage is
 * hardcoded. Uses BigInt so rounding is exact.
 */
export function vatPortionOfGross(
  grossAmount: number,
  vatRateBasisPoints: number,
): number {
  assertValidAmount(grossAmount, "grossAmount");
  if (
    !Number.isInteger(vatRateBasisPoints) ||
    vatRateBasisPoints < 0 ||
    vatRateBasisPoints > 10_000
  ) {
    throw new RangeError("vatRateBasisPoints must be an integer in 0–10000");
  }
  const gross = BigInt(grossAmount);
  const rate = BigInt(vatRateBasisPoints);
  const denominator = 10_000n + rate;
  // round(gross × rate / denominator) with halves rounded up
  const vat = (2n * gross * rate + denominator) / (2n * denominator);
  return Number(vat);
}

/**
 * Parses a kronor amount typed by an administrator into öre, using string
 * arithmetic only (no floats). Accepts "1499", "1 499", "1499,50",
 * "1499.5" and an optional "kr" suffix; spaces (including the non-breaking
 * spaces sv-SE formatting produces) are ignored. Returns null for anything
 * else: negative values, more than two decimals, letters, or amounts above
 * MAX_AMOUNT.
 */
export function parseSekInput(input: string): number | null {
  const compact = input
    .replace(/[\s  ]/g, "")
    .replace(/kr$/i, "")
    .replace(/:-$/, "");
  const match = /^(\d{1,8})(?:[.,](\d{1,2}))?$/.exec(compact);
  if (!match) return null;
  const kronor = Number(match[1]);
  const ore = Number((match[2] ?? "").padEnd(2, "0"));
  const amount = kronor * 100 + ore;
  return isValidAmount(amount) ? amount : null;
}

/**
 * Formats öre for an admin input field: "1499" for whole kronor, "1499,50"
 * otherwise. The inverse of parseSekInput.
 */
export function formatSekInput(amount: number): string {
  assertValidAmount(amount);
  const kronor = Math.floor(amount / 100);
  const ore = amount % 100;
  return ore === 0
    ? String(kronor)
    : `${kronor},${String(ore).padStart(2, "0")}`;
}

const sekFormatter = new Intl.NumberFormat("sv-SE", {
  style: "currency",
  currency: "SEK",
});

const sekWholeFormatter = new Intl.NumberFormat("sv-SE", {
  style: "currency",
  currency: "SEK",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Exact SEK display with öre, e.g. 149900 → "1 499,00 kr" (receipts, admin). */
export function formatSek(amount: number): string {
  if (!Number.isInteger(amount)) {
    throw new InvalidAmountError("amount");
  }
  return sekFormatter.format(amount / 100);
}

/**
 * Storefront price display: whole kronor without decimals ("1 499 kr"), and
 * öre only when present ("49,50 kr"). Never rounds: the amount is exact.
 */
export function formatPrice(amount: number): string {
  if (!Number.isInteger(amount)) {
    throw new InvalidAmountError("amount");
  }
  return amount % 100 === 0
    ? sekWholeFormatter.format(amount / 100)
    : sekFormatter.format(amount / 100);
}
