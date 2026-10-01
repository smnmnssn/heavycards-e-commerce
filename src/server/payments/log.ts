import { logSafe } from "@/server/logging/safe-log";

/**
 * Payment logging. Only identifiers and safe categories are ever logged:
 * Stripe event IDs and types, HeavyCards order IDs, outcome or problem
 * codes, and an error's name/type/code. Never request bodies, customer names,
 * addresses, emails, signatures or secrets.
 */
export function logPayment(
  level: "info" | "error",
  message: string,
  fields: {
    eventId?: string;
    eventType?: string;
    orderId?: string | null;
    outcome?: string;
    problem?: string;
    error?: unknown;
    [key: string]: unknown;
  },
) {
  logSafe("payments", level, message, fields);
}
