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
  REVIEW_LINK_SECRET: optionalNonEmpty(
    z
      .string()
      .min(32, "must be at least 32 characters (e.g. openssl rand -base64 32)"),
  ),
  REVIEW_LINK_SECRET_PREVIOUS: optionalNonEmpty(
    z
      .string()
      .min(32, "must be at least 32 characters (e.g. openssl rand -base64 32)"),
  ),
  EMAIL_TRANSPORT: optionalNonEmpty(z.enum(["resend", "console", "file"])),
  RESEND_API_KEY: optionalNonEmpty(
    z.string().regex(/^re_\S+$/, "must be a Resend API key (re_…)"),
  ),
  EMAIL_FROM: optionalNonEmpty(
    z.string().refine((value) => parseSender(value) !== null, {
      message:
        'must be an email address or "Name <address>", e.g. "HeavyCards <order@heavycards.se>"',
    }),
  ),
  EMAIL_OUTBOX_DIR: optionalNonEmpty(z.string()),
  STORAGE_PROVIDER: optionalNonEmpty(z.enum(["vercel-blob", "local"])),
  BLOB_READ_WRITE_TOKEN: optionalNonEmpty(z.string()),
  STORAGE_LOCAL_DIR: optionalNonEmpty(z.string()),
  PAYMENT_GATEWAY: optionalNonEmpty(z.enum(["stripe", "fake"])),
  FAKE_STRIPE_STATE_DIR: optionalNonEmpty(z.string()),
  STRIPE_WEBHOOK_SECRET: optionalNonEmpty(
    z
      .string()
      .regex(
        /^whsec_[A-Za-z0-9_]+$/,
        "must be a Stripe webhook signing secret",
      ),
  ),
  CRON_SECRET: optionalNonEmpty(
    z.string().min(16, "must be at least 16 characters"),
  ),
  STRIPE_SECRET_KEY: optionalNonEmpty(
    z
      .string()
      .regex(
        /^(sk|rk)_(test|live)_[A-Za-z0-9]+$/,
        "must be a Stripe secret or restricted key",
      ),
  ),
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

/**
 * Where product images are stored (PROJECT.md §4, §14):
 * - `vercel-blob`: Vercel Blob (default and only option on Vercel). The
 *   read/write token is required in Vercel production; on previews without
 *   one, uploads fail with a clear admin error while the store keeps working.
 * - `local`: files in a git-ignored local directory, served by
 *   `/api/media/*`. For development and E2E only; refused on Vercel.
 */
export type StorageConfig = Readonly<
  | { provider: "vercel-blob"; blobToken: string | null }
  | { provider: "local"; directory: string }
>;

export const DEFAULT_LOCAL_STORAGE_DIR = ".storage";

/**
 * How Checkout Sessions are created (src/server/checkout):
 * - `stripe` (default): Stripe Hosted Checkout. Without a secret key the
 *   store works, but checkout answers "payment unavailable". Live keys are
 *   accepted only in Vercel production, and production requires one, so test
 *   and live credentials are never mixed.
 * - `fake`: an in-process stand-in that never contacts Stripe and returns
 *   checkout.stripe.com-shaped URLs. For local E2E runs only; refused on
 *   Vercel. With FAKE_STRIPE_STATE_DIR its sessions are JSON files the E2E
 *   tests can edit to play Stripe.
 *
 * `webhookSecret` (STRIPE_WEBHOOK_SECRET) verifies Stripe webhook signatures;
 * without it the webhook endpoint answers 503 so Stripe retries later. It is
 * required in Vercel production.
 */
export type PaymentConfig = Readonly<
  (
    | { gateway: "stripe"; secretKey: string | null }
    | { gateway: "fake"; stateDir: string | null }
  ) & { webhookSecret: string | null }
>;

const PLACEHOLDER_SENDER = "HeavyCards <no-reply@heavycards.invalid>";

/** `a@b.se` or `Name <a@b.se>` → the address's domain; null if malformed. */
export function parseSender(value: string): { domain: string } | null {
  const match = /^\s*(?:[^<>]*?\s*<([^<>\s]+)>|([^<>\s]+))\s*$/.exec(value);
  const address = match?.[1] ?? match?.[2];
  if (!address || !z.email().safeParse(address).success) return null;
  return { domain: address.slice(address.lastIndexOf("@") + 1).toLowerCase() };
}

/**
 * Domains that can never be HeavyCards' verified production sender:
 * reserved test/example domains and Resend's shared testing domain.
 */
const isPlaceholderSenderDomain = (domain: string) =>
  domain === "resend.dev" ||
  /(^|\.)example\.(com|net|org)$/.test(domain) ||
  /\.(invalid|test|example|localhost|local)$/.test(domain);

/**
 * Secrets for review links (src/server/domain/review-token.ts). Production
 * requires the dedicated REVIEW_LINK_SECRET; elsewhere AUTH_SECRET is used
 * when it is unset.
 */
export type ReviewLinkSecrets = Readonly<{
  reviewLinkSecret: string | null;
  previousReviewLinkSecret: string | null;
  authSecret: string;
}>;

export type ServerEnv = Readonly<{
  nodeEnv: "development" | "test" | "production";
  vercelEnv: "development" | "preview" | "production" | undefined;
  /** Canonical origin without trailing slash, e.g. `https://heavycards.se`. */
  siteUrl: string;
  /** PostgreSQL connection URL. Contains credentials: never log it. */
  databaseUrl: string;
  /** Signs auth cookies and tokens. Secret: never log it. */
  authSecret: string;
  /** Review-link key material. Secret: never log it. */
  reviewLinks: ReviewLinkSecrets;
  email: EmailConfig;
  storage: StorageConfig;
  payments: PaymentConfig;
  /**
   * Bearer secret Vercel Cron sends to scheduled routes (CRON_SECRET).
   * Required in Vercel production; without it the routes refuse every call.
   */
  cronSecret: string | null;
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
    if (env.VERCEL_ENV === "production" && isLoopbackHost(url.hostname)) {
      return new Error(
        "APP_URL: must be the public domain in the Vercel production environment",
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

const isLoopbackHost = (hostname: string) =>
  hostname === "localhost" ||
  hostname.endsWith(".localhost") ||
  hostname === "[::1]" ||
  hostname === "::1" ||
  hostname.startsWith("127.");

function resolveDatabase(
  env: z.infer<typeof rawServerEnvSchema>,
): string | Error {
  if (
    env.VERCEL_ENV === "production" &&
    isLoopbackHost(new URL(env.DATABASE_URL).hostname)
  ) {
    return new Error(
      "DATABASE_URL: points at a local database in the Vercel production environment",
    );
  }
  return env.DATABASE_URL;
}

function resolveReviewLinks(
  env: z.infer<typeof rawServerEnvSchema>,
): ReviewLinkSecrets | Error {
  const current = env.REVIEW_LINK_SECRET ?? null;
  const previous = env.REVIEW_LINK_SECRET_PREVIOUS ?? null;
  if (env.VERCEL_ENV === "production" && !current) {
    return new Error(
      "REVIEW_LINK_SECRET: required in the Vercel production environment",
    );
  }
  if (current !== null && current === env.AUTH_SECRET) {
    return new Error("REVIEW_LINK_SECRET: must differ from AUTH_SECRET");
  }
  if (previous !== null && current === null) {
    return new Error(
      "REVIEW_LINK_SECRET_PREVIOUS: only used together with REVIEW_LINK_SECRET",
    );
  }
  return {
    reviewLinkSecret: current,
    previousReviewLinkSecret: previous,
    authSecret: env.AUTH_SECRET,
  };
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
    // Automated test runs must never reach real customers, whatever a
    // developer's .env.local says.
    if (env.NODE_ENV === "test") {
      return new Error(
        "EMAIL_TRANSPORT: resend is refused when NODE_ENV=test; tests use the console, file or memory transport",
      );
    }
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
      return new Error(
        "RESEND_API_KEY and EMAIL_FROM: required when email is sent through Resend",
      );
    }
    if (
      isVercelProduction &&
      isPlaceholderSenderDomain(parseSender(env.EMAIL_FROM)!.domain)
    ) {
      return new Error(
        "EMAIL_FROM: must use HeavyCards' own domain verified in Resend in the Vercel production environment",
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

function resolveStorage(
  env: z.infer<typeof rawServerEnvSchema>,
): StorageConfig | Error {
  const provider =
    env.STORAGE_PROVIDER ?? (env.VERCEL_ENV ? "vercel-blob" : "local");

  if (provider === "local") {
    if (env.VERCEL_ENV) {
      return new Error(
        "STORAGE_PROVIDER: local is for local development and tests only; use vercel-blob on Vercel",
      );
    }
    return {
      provider,
      directory: env.STORAGE_LOCAL_DIR ?? DEFAULT_LOCAL_STORAGE_DIR,
    };
  }
  if (env.VERCEL_ENV === "production" && !env.BLOB_READ_WRITE_TOKEN) {
    return new Error(
      "BLOB_READ_WRITE_TOKEN: required in the Vercel production environment (connect a Vercel Blob store)",
    );
  }
  return { provider, blobToken: env.BLOB_READ_WRITE_TOKEN ?? null };
}

function resolvePayments(
  env: z.infer<typeof rawServerEnvSchema>,
): PaymentConfig | Error {
  const gateway = env.PAYMENT_GATEWAY ?? "stripe";
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET ?? null;
  if (env.VERCEL_ENV === "production" && !webhookSecret) {
    return new Error(
      "STRIPE_WEBHOOK_SECRET: required in the Vercel production environment",
    );
  }
  if (gateway === "fake") {
    if (env.VERCEL_ENV) {
      return new Error("PAYMENT_GATEWAY: fake is for local test runs only");
    }
    return {
      gateway,
      stateDir: env.FAKE_STRIPE_STATE_DIR ?? null,
      webhookSecret,
    };
  }
  if (env.FAKE_STRIPE_STATE_DIR) {
    return new Error(
      "FAKE_STRIPE_STATE_DIR: only used with PAYMENT_GATEWAY=fake",
    );
  }

  const key = env.STRIPE_SECRET_KEY ?? null;
  const isLive = key !== null && /^(sk|rk)_live_/.test(key);
  if (env.VERCEL_ENV === "production") {
    if (!isLive) {
      return new Error(
        "STRIPE_SECRET_KEY: a live key is required in the Vercel production environment",
      );
    }
  } else if (isLive) {
    return new Error(
      "STRIPE_SECRET_KEY: live keys are only allowed in the Vercel production environment; use a test key",
    );
  }
  return { gateway, secretKey: key, webhookSecret };
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
  const databaseUrl = resolveDatabase(result.data);
  const reviewLinks = resolveReviewLinks(result.data);
  const email = resolveEmail(result.data);
  const storage = resolveStorage(result.data);
  const payments = resolvePayments(result.data);
  const cron =
    result.data.VERCEL_ENV === "production" && !result.data.CRON_SECRET
      ? new Error(
          "CRON_SECRET: required in the Vercel production environment (checkout reconciliation)",
        )
      : null;
  const errors = [
    siteUrl,
    databaseUrl,
    reviewLinks,
    email,
    storage,
    payments,
    cron,
  ].filter((value) => value instanceof Error);
  if (
    siteUrl instanceof Error ||
    databaseUrl instanceof Error ||
    reviewLinks instanceof Error ||
    email instanceof Error ||
    storage instanceof Error ||
    payments instanceof Error ||
    cron
  ) {
    throw new EnvValidationError(errors.map((error) => error.message));
  }

  return Object.freeze({
    nodeEnv: result.data.NODE_ENV,
    vercelEnv: result.data.VERCEL_ENV,
    siteUrl,
    databaseUrl,
    authSecret: result.data.AUTH_SECRET,
    reviewLinks: Object.freeze(reviewLinks),
    email: Object.freeze(email),
    storage: Object.freeze(storage),
    payments: Object.freeze(payments),
    cronSecret: result.data.CRON_SECRET ?? null,
  });
}
