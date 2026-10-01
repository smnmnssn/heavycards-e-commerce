/**
 * Structured server logging that cannot leak personal data or secrets.
 * Only primitive values (and arrays of them) are logged; an error is reduced
 * to its name, type, code and request ID, never its message, which may
 * echo a request body, an address or a provider response. Callers pass
 * identifiers (order IDs, event IDs) and outcome codes, never names, email
 * addresses, phone numbers, message bodies, tokens or keys.
 */
export function logSafe(
  prefix: string,
  level: "info" | "error",
  message: string,
  fields: { error?: unknown; [key: string]: unknown },
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
  const fromError = Object.fromEntries(
    Object.entries({
      error: details.name,
      errorType: details.type,
      errorCode: details.code,
      requestId: details.requestId,
    }).filter(([, value]) => typeof value === "string"),
  );
  const safe = Object.fromEntries(
    Object.entries({ ...rest, ...fromError }).filter(
      ([, value]) =>
        value !== undefined &&
        (typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean" ||
          Array.isArray(value)),
    ),
  );
  (level === "error" ? console.error : console.info)(
    `[${prefix}] ${message}`,
    safe,
  );
}
