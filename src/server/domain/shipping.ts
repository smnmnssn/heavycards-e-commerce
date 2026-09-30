import { assertValidAmount } from "@/lib/money";

export type ShippingSettings = {
  shippingPriceAmount: number;
  /** NULL disables free shipping. */
  freeShippingThresholdAmount: number | null;
};

/**
 * Flat-rate shipping with an optional free-shipping threshold. The threshold
 * compares against the VAT-inclusive merchandise subtotal and is inclusive
 * ("fri frakt från 1 500 kr" means exactly 1 500 kr qualifies).
 */
export function calculateShippingAmount(
  subtotalAmount: number,
  settings: ShippingSettings,
): number {
  assertValidAmount(subtotalAmount, "subtotalAmount");
  assertValidAmount(settings.shippingPriceAmount, "shippingPriceAmount");

  const threshold = settings.freeShippingThresholdAmount;
  if (threshold !== null) {
    assertValidAmount(threshold, "freeShippingThresholdAmount");
    if (subtotalAmount >= threshold) {
      return 0;
    }
  }
  return settings.shippingPriceAmount;
}
