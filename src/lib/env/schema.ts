import { z } from "zod";

/**
 * Server environment validation.
 *
 * This module is intentionally free of `server-only` so it can also be used
 * from `instrumentation.ts` and unit tests. Application code should import the
 * parsed values from `@/lib/env/server` instead.
 *
 * Variables are added to the schema in the milestone that first consumes them
 * (database, Stripe, Resend, auth, storage). `.env.example` lists the full set.
 */

const LOCAL_DEVELOPMENT_URL = "http://localhost:3000";

// `.env` files commonly contain `KEY=` placeholders; treat those as unset.
const optionalNonEmpty = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    schema.optional(),
  );

const httpUrl = z.url({ protocol: /^https?$/ });

const postgresUrl = z.url({
  protocol: /^postgres(ql)?$/,
  error: "must be a postgresql:// connection URL",
});

const rawServerEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  VERCEL_ENV: optionalNonEmpty(
    z.enum(["development", "preview", "production"]),
  ),
  VERCEL_URL: optionalNonEmpty(z.string()),
  APP_URL: optionalNonEmpty(httpUrl),
  DATABASE_URL: postgresUrl,
  AUTH_SECRET: z
    .string({ error: "required" })
    .min(32, "must be at least 32 characters (e.g. openssl rand -base64 32)"),
  EMAIL_TRANSPORT: optionalNonEmpty(z.enum(["resend", "console", "file"])),
  RESEND_API_KEY: optionalNonEmpty(z.string()),
  EMAIL_FROM: optionalNonEmpty(z.string()),
  EMAIL_OUTBOX_DIR: optionalNonEmpty(z.string()),
});

/**
 * How outgoing email is delivered:
 * - `resend`: real delivery through Resend (required in Vercel production).
 * - `console`: nothing is sent; the server log shows recipient and subject
 *   (and, outside production builds, the message text with its link).
 * - `file`: nothing is sent; each message is written as JSON to a local
 *   directory. Used by the end-to-end tests to read invitation links.
 */
export type EmailConfig = Readonly<
  | { transport: "resend"; from: string; resendApiKey: string }
  | { transport: "console"; from: string }
  | { transport: "file"; from: string; outboxDir: string }
>;

const PLACEHOLDER_SENDER = "HeavyCards <no-reply@heavycards.invalid>";

export type ServerEnv = Readonly<{
  nodeEnv: "development" | "test" | "production";
  vercelEnv: "development" | "preview" | "production" | undefined;
  /** Canonical origin without trailing slash, e.g. `https://heavycards.se`. */
  siteUrl: string;
  /** PostgreSQL connection URL. Contains credentials: never log it. */
  databaseUrl: string;
  /** Signs auth cookies and tokens. Secret: never log it. */
  authSecret: string;
  email: EmailConfig;
}>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: readonly string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`,
    );
    this.name = "EnvValidationError";
  }
}

/**
 * Resolves the public site origin used for canonical URLs, metadata and
 * absolute links in emails.
 *
 * Production must be explicit: silently falling back to a preview or localhost
 * URL would emit wrong canonical URLs to search engines and customers.
 */
function resolveSiteUrl(
  env: z.infer<typeof rawServerEnvSchema>,
): string | Error {
  if (env.APP_URL) {
    const url = new URL(env.APP_URL);
    if (env.VERCEL_ENV === "production" && url.protocol !== "https:") {
      return new Error(
        "APP_URL: must use https in the Vercel production environment",
      );
    }
    if (url.pathname !== "/" || url.search || url.hash) {
      return new Error(
        "APP_URL: must be an origin without path, query or fragment",
      );
    }
    return url.origin;
  }

  if (env.VERCEL_ENV === "production") {
    return new Error("APP_URL: required in the Vercel production environment");
  }
  if (env.VERCEL_URL) {
    return `https://${env.VERCEL_URL}`;
  }
  if (env.NODE_ENV === "production") {
    return new Error("APP_URL: required for production builds and servers");
  }
  return LOCAL_DEVELOPMENT_URL;
}

function resolveEmail(
  env: z.infer<typeof rawServerEnvSchema>,
): EmailConfig | Error {
  const isVercelProduction = env.VERCEL_ENV === "production";
  const transport =
    env.EMAIL_TRANSPORT ?? (isVercelProduction ? "resend" : "console");

  if (isVercelProduction && transport !== "resend") {
    return new Error(
      "EMAIL_TRANSPORT: must be resend in the Vercel production environment",
    );
  }
  if (transport === "resend") {
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
      return new Error(
        "RESEND_API_KEY and EMAIL_FROM: required when email is sent through Resend",
      );
    }
    return {
      transport,
      from: env.EMAIL_FROM,
      resendApiKey: env.RESEND_API_KEY,
    };
  }
  const from = env.EMAIL_FROM ?? PLACEHOLDER_SENDER;
  if (transport === "file") {
    if (env.VERCEL_ENV) {
      return new Error("EMAIL_TRANSPORT: file is for local test runs only");
    }
    if (!env.EMAIL_OUTBOX_DIR) {
      return new Error("EMAIL_OUTBOX_DIR: required when EMAIL_TRANSPORT=file");
    }
    return { transport, from, outboxDir: env.EMAIL_OUTBOX_DIR };
  }
  return { transport, from };
}

/**
 * Validates a raw environment object. Error messages name the offending
 * variables but never echo their values, so secrets cannot leak into logs.
 */
export function parseServerEnv(
  source: Record<string, string | undefined>,
): ServerEnv {
  const result = rawServerEnvSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map(
        (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      ),
    );
  }

  const siteUrl = resolveSiteUrl(result.data);
  const email = resolveEmail(result.data);
  const errors = [siteUrl, email].filter((value) => value instanceof Error);
  if (siteUrl instanceof Error || email instanceof Error) {
    throw new EnvValidationError(errors.map((error) => error.message));
  }

  return Object.freeze({
    nodeEnv: result.data.NODE_ENV,
    vercelEnv: result.data.VERCEL_ENV,
    siteUrl,
    databaseUrl: result.data.DATABASE_URL,
    authSecret: result.data.AUTH_SECRET,
    email: Object.freeze(email),
  });
}
