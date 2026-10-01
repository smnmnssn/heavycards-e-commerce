import { z } from "zod";

/**
 * A carrier tracking number as typed by staff: trimmed, letters, digits,
 * spaces and - . / _ only (PostNord numbers are e.g. "00370712345678901234"
 * or "RR123456789SE"). Blank means "none".
 */
export const trackingNumberSchema = z
  .string()
  .trim()
  .max(100, "Spårningsnumret får vara högst 100 tecken.")
  .regex(
    /^[\p{L}\p{N} ./_-]*$/u,
    "Spårningsnumret får bara innehålla bokstäver, siffror, mellanslag och - . / _",
  )
  .transform((value) => (value === "" ? null : value));

/** Input of a fulfillment transition (untrusted, from an admin form). */
export const fulfillmentTransitionSchema = z.object({
  orderId: z.uuid(),
  to: z.enum(["PROCESSING", "SHIPPED", "COMPLETED", "CANCELLED"]),
  trackingNumber: trackingNumberSchema.optional(),
  shippingCarrier: z.enum(["POSTNORD", "OTHER"]).optional(),
});

export type FulfillmentTransitionInput = z.input<
  typeof fulfillmentTransitionSchema
>;
