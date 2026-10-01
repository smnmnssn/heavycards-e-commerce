import { describe, expect, it } from "vitest";

import {
  decideAfterFailure,
  deliveryEligibility,
  emailIdempotencyKey,
  MAX_ATTEMPTS,
  PROVIDER_IDEMPOTENCY_WINDOW_MS,
  providerWindowExpired,
  RETRY_DELAYS_MS,
  SEND_LEASE_MS,
} from "@/server/domain/email-delivery";
import { SEND_TIMEOUT_MS } from "@/lib/email/transport";

const ORDER_ID = "0192f0c1-aaaa-7bbb-8ccc-123456789abc";
const now = new Date("2026-10-02T10:00:00Z");

describe("idempotency keys", () => {
  it("are deterministic per order and kind", () => {
    expect(emailIdempotencyKey("ORDER_CONFIRMATION", ORDER_ID)).toBe(
      `order-confirmation/${ORDER_ID}`,
    );
    expect(emailIdempotencyKey("ORDER_SHIPPED", ORDER_ID)).toBe(
      `order-shipped/${ORDER_ID}`,
    );
  });

  it("fit Resend's 1–256 character limit", () => {
    expect(emailIdempotencyKey("ORDER_CONFIRMATION", ORDER_ID).length).toBe(55);
  });
});

describe("retry decisions", () => {
  it("backs off between attempts", () => {
    const delays = Array.from({ length: MAX_ATTEMPTS - 1 }, (_, i) => {
      const decision = decideAfterFailure({
        attempts: i + 1,
        failure: "not_sent",
        code: "rate_limit_exceeded",
        now,
      });
      expect(decision.action).toBe("retry");
      return decision.action === "retry"
        ? decision.nextAttemptAt.getTime() - now.getTime()
        : 0;
    });
    expect(delays).toEqual(RETRY_DELAYS_MS);
    expect([...delays].sort((a, b) => a - b)).toEqual(delays);
  });

  it("gives up after the last attempt instead of retrying forever", () => {
    expect(
      decideAfterFailure({
        attempts: MAX_ATTEMPTS,
        failure: "unknown",
        code: "timeout",
        now,
      }),
    ).toEqual({ action: "give_up", problem: "max_attempts" });
  });

  it("never retries an idempotency conflict", () => {
    expect(
      decideAfterFailure({
        attempts: 1,
        failure: "conflict",
        code: "invalid_idempotent_request",
        now,
      }),
    ).toEqual({ action: "give_up", problem: "invalid_idempotent_request" });
  });

  it("fits every retry inside the provider's idempotency window", () => {
    const total = RETRY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0);
    expect(total).toBeLessThan(PROVIDER_IDEMPOTENCY_WINDOW_MS);
    expect(PROVIDER_IDEMPOTENCY_WINDOW_MS).toBeLessThan(24 * 60 * 60 * 1000);
  });

  it("leases longer than a send can take", () => {
    expect(SEND_LEASE_MS).toBeGreaterThan(SEND_TIMEOUT_MS * 2);
  });
});

describe("provider idempotency window", () => {
  it("is open without an unknown outcome", () => {
    expect(providerWindowExpired(null, now)).toBe(false);
  });

  it("closes 23 hours after the first unknown outcome", () => {
    const at = (ms: number) => new Date(now.getTime() - ms);
    expect(
      providerWindowExpired(at(PROVIDER_IDEMPOTENCY_WINDOW_MS - 1), now),
    ).toBe(false);
    expect(providerWindowExpired(at(PROVIDER_IDEMPOTENCY_WINDOW_MS), now)).toBe(
      true,
    );
  });
});

describe("eligibility when sending", () => {
  it.each([
    ["PAID", true, undefined],
    ["PARTIALLY_REFUNDED", true, undefined],
    ["REFUNDED", false, "order_refunded"],
    ["PENDING", false, "order_not_paid"],
    ["FAILED", false, "order_not_paid"],
    ["EXPIRED", false, "order_not_paid"],
  ] as const)(
    "confirmation for a %s order: %s",
    (paymentStatus, ok, reason) => {
      expect(
        deliveryEligibility("ORDER_CONFIRMATION", {
          paymentStatus,
          fulfillmentStatus: "NEW",
        }),
      ).toEqual(ok ? { ok } : { ok, reason });
    },
  );

  it.each([
    ["SHIPPED", true],
    ["COMPLETED", true],
    ["NEW", false],
    ["PROCESSING", false],
    ["CANCELLED", false],
  ] as const)("shipping email for a %s order: %s", (fulfillmentStatus, ok) => {
    expect(
      deliveryEligibility("ORDER_SHIPPED", {
        paymentStatus: "PAID",
        fulfillmentStatus,
      }).ok,
    ).toBe(ok);
  });
});
