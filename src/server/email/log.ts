import { logSafe } from "@/server/logging/safe-log";

/**
 * Email logging: delivery and order IDs, the email kind, the attempt
 * number, outcome and error codes. Never the recipient, the customer's
 * name or address, the message, the idempotency key's provider response or
 * the API key.
 */
export function logEmail(
  level: "info" | "error",
  message: string,
  fields: {
    deliveryId?: string;
    orderId?: string;
    kind?: string;
    attempt?: number;
    outcome?: string;
    errorCode?: string;
    error?: unknown;
    [key: string]: unknown;
  },
) {
  logSafe("email", level, message, fields);
}
