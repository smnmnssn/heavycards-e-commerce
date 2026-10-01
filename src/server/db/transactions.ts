import { Prisma } from "@/generated/prisma/client";

/*
 * Helpers for transactions that take row locks under concurrency.
 *
 * With the pg driver adapter, PostgreSQL errors raised by raw queries arrive
 * as PrismaClientKnownRequestError P2010, with the SQLSTATE in
 * `meta.driverAdapterError.cause.originalCode`. Model operations report
 * write conflicts and deadlocks as P2034.
 */

/** SQLSTATE of a PostgreSQL error wrapped by Prisma, if any. */
export function postgresErrorCode(error: unknown): string | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
  const meta = error.meta as
    { driverAdapterError?: { cause?: { originalCode?: unknown } } } | undefined;
  const code = meta?.driverAdapterError?.cause?.originalCode;
  return typeof code === "string" ? code : null;
}

const SERIALIZATION_FAILURE = "40001";
const DEADLOCK_DETECTED = "40P01";
const LOCK_NOT_AVAILABLE = "55P03";

/** Deadlocks and serialization failures: safe to retry the whole transaction. */
export function isRetryableTransactionError(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  ) {
    return true;
  }
  const code = postgresErrorCode(error);
  return code === SERIALIZATION_FAILURE || code === DEADLOCK_DETECTED;
}

/** A lock wait exceeded `lock_timeout`: the system is busy right now. */
export function isLockTimeout(error: unknown): boolean {
  return postgresErrorCode(error) === LOCK_NOT_AVAILABLE;
}

export const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2002";

/**
 * Runs `transaction` again (up to `attempts` times in total) when PostgreSQL
 * aborts it with a deadlock or serialization failure. The callback must be a
 * complete transaction: every retry starts from scratch.
 */
export async function withTransactionRetry<T>(
  transaction: () => Promise<T>,
  {
    attempts = 3,
    backoffMs = 25,
  }: { attempts?: number; backoffMs?: number } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await transaction();
    } catch (error) {
      if (attempt >= attempts || !isRetryableTransactionError(error)) {
        throw error;
      }
      // Jittered backoff so the competing transactions do not collide again.
      const delay = backoffMs * attempt * (1 + Math.random());
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
