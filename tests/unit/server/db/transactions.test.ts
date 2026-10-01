import { describe, expect, it, vi } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import {
  isLockTimeout,
  isRetryableTransactionError,
  postgresErrorCode,
  withTransactionRetry,
} from "@/server/db/transactions";

/** The shape Prisma 7 + @prisma/adapter-pg produce (observed 2026-10-01). */
const pgError = (originalCode: string) =>
  new Prisma.PrismaClientKnownRequestError("Raw query failed", {
    code: "P2010",
    clientVersion: "7.10.0",
    meta: { driverAdapterError: { cause: { originalCode } } },
  });

describe("transaction error classification", () => {
  it("reads the PostgreSQL SQLSTATE from wrapped errors", () => {
    expect(postgresErrorCode(pgError("40P01"))).toBe("40P01");
    expect(postgresErrorCode(new Error("x"))).toBeNull();
  });

  it("retries deadlocks and serialization failures only", () => {
    expect(isRetryableTransactionError(pgError("40P01"))).toBe(true);
    expect(isRetryableTransactionError(pgError("40001"))).toBe(true);
    expect(
      isRetryableTransactionError(
        new Prisma.PrismaClientKnownRequestError("conflict", {
          code: "P2034",
          clientVersion: "7.10.0",
        }),
      ),
    ).toBe(true);
    expect(isRetryableTransactionError(pgError("23505"))).toBe(false);
    expect(isRetryableTransactionError(new Error("x"))).toBe(false);
  });

  it("recognises lock timeouts", () => {
    expect(isLockTimeout(pgError("55P03"))).toBe(true);
    expect(isLockTimeout(pgError("40P01"))).toBe(false);
  });
});

describe("withTransactionRetry", () => {
  it("re-runs the whole transaction after a deadlock", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(pgError("40P01"))
      .mockResolvedValue("ok");

    await expect(withTransactionRetry(run, { backoffMs: 0 })).resolves.toBe(
      "ok",
    );
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("gives up after the configured attempts", async () => {
    const run = vi.fn().mockRejectedValue(pgError("40001"));

    await expect(
      withTransactionRetry(run, { attempts: 3, backoffMs: 0 }),
    ).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("does not retry other errors", async () => {
    const run = vi.fn().mockRejectedValue(new Error("validation"));

    await expect(withTransactionRetry(run, { backoffMs: 0 })).rejects.toThrow(
      "validation",
    );
    expect(run).toHaveBeenCalledTimes(1);
  });
});
