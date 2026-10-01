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
  const { error, ...rest } = fields;
  const details =
    error && typeof error === "object"
      ? (error as {
          name?: unknown;
          type?: unknown;
          code?: unknown;
          requestId?: unknown;
        })
      : {};
  const safe = Object.fromEntries(
    Object.entries({
      ...rest,
      error: typeof details.name === "string" ? details.name : undefined,
      errorType: typeof details.type === "string" ? details.type : undefined,
      errorCode: typeof details.code === "string" ? details.code : undefined,
      requestId:
        typeof details.requestId === "string" ? details.requestId : undefined,
    }).filter(
      ([, value]) =>
        value !== undefined &&
        (typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean" ||
          Array.isArray(value)),
    ),
  );
  (level === "error" ? console.error : console.info)(
    `[payments] ${message}`,
    safe,
  );
}
