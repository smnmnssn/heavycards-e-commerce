import type { PrismaClient } from "@/generated/prisma/client";

import { pruneRateLimits } from "./rate-limit";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes data that has served its purpose and would otherwise be kept
 * forever (Milestone 14, data minimisation). Run by the scheduled job
 * (src/server/payments/cron.ts); safe to run repeatedly and concurrently.
 *
 * - `rate_limit_buckets`: windows older than a day (HMACs of client IPs;
 *   also pruned after checkout requests).
 * - `auth_rate_limits`: Better Auth's counters, keyed by the raw client IP;
 *   the longest window is 15 minutes, so a day-old row is useless.
 * - `admin_sessions` that have expired (they carry the IP address and user
 *   agent of the sign-in) and spent `auth_verifications` (password-reset
 *   values). Both are already refused by Better Auth; this only removes
 *   them.
 */
export async function pruneExpiredSecurityData(
  db: PrismaClient,
  now: Date,
): Promise<{
  rateLimitBuckets: number;
  authRateLimits: number;
  adminSessions: number;
  authVerifications: number;
}> {
  const dayAgo = now.getTime() - DAY_MS;
  const [rateLimitBuckets, authRateLimits, adminSessions, authVerifications] =
    await Promise.all([
      pruneRateLimits(db, now),
      db.authRateLimit
        .deleteMany({ where: { lastRequest: { lt: BigInt(dayAgo) } } })
        .then(({ count }) => count),
      db.adminSession
        .deleteMany({ where: { expiresAt: { lt: now } } })
        .then(({ count }) => count),
      db.authVerification
        .deleteMany({ where: { expiresAt: { lt: now } } })
        .then(({ count }) => count),
    ]);
  return { rateLimitBuckets, authRateLimits, adminSessions, authVerifications };
}
