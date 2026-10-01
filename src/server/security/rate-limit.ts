import { createHmac } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";

/*
 * Fixed-window rate limiting in PostgreSQL, shared by every serverless
 * instance (an in-memory counter would be per instance on Vercel). One
 * atomic upsert per request; no read-then-write race.
 *
 * Client IPs are personal data, so only an HMAC of the IP (keyed with the
 * application secret) is stored, and windows older than a day are deleted.
 */

export type RateLimitRule = Readonly<{
  scope: string;
  limit: number;
  windowMs: number;
}>;

/**
 * Checkout creation reserves stock and creates Stripe sessions, so it is
 * limited per client: generous for a customer fixing their cart, far too
 * few to hold a meaningful amount of stock.
 */
export const CHECKOUT_RATE_LIMIT: RateLimitRule = {
  scope: "checkout",
  limit: 15,
  windowMs: 10 * 60 * 1000,
};

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

/**
 * Client IP as set by the platform. On Vercel the first `x-forwarded-for`
 * entry is the client address and cannot be chosen by the client; behind a
 * proxy that forwards a client-supplied header this would need adjusting.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

export function rateLimitKey(
  rule: RateLimitRule,
  ip: string,
  secret: string,
): string {
  const digest = createHmac("sha256", secret).update(ip).digest("hex");
  return `${rule.scope}:${digest.slice(0, 40)}`;
}

export async function consumeRateLimit(
  db: PrismaClient,
  rule: RateLimitRule,
  key: string,
  now: Date,
): Promise<RateLimitResult> {
  const windowStart = new Date(
    Math.floor(now.getTime() / rule.windowMs) * rule.windowMs,
  );
  const [row] = await db.$queryRaw<Array<{ count: number }>>`
    INSERT INTO rate_limit_buckets (key, window_start, count)
    VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT (key, window_start)
    DO UPDATE SET count = rate_limit_buckets.count + 1
    RETURNING count`;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((windowStart.getTime() + rule.windowMs - now.getTime()) / 1000),
  );
  return { allowed: (row?.count ?? 0) <= rule.limit, retryAfterSeconds };
}

export async function pruneRateLimits(
  db: PrismaClient,
  now: Date,
  maxAgeMs = 24 * 60 * 60 * 1000,
): Promise<number> {
  return db.rateLimitBucket
    .deleteMany({
      where: { windowStart: { lt: new Date(now.getTime() - maxAgeMs) } },
    })
    .then(({ count }) => count);
}
