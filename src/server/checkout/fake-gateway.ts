import { randomUUID } from "node:crypto";

import { STRIPE_CHECKOUT_ORIGIN } from "@/lib/checkout/checkout";

import type {
  CheckoutGateway,
  CheckoutSessionInput,
  CreatedCheckoutSession,
  ExpireOutcome,
} from "./gateway";

type FakeSession = CreatedCheckoutSession & {
  status: "open" | "complete" | "expired";
  input: CheckoutSessionInput;
};

/**
 * In-memory stand-in for Stripe Checkout, used by database tests and local
 * E2E runs (PAYMENT_GATEWAY=fake, refused on Vercel). It never makes network
 * requests. Like Stripe, it returns the same session for a repeated
 * idempotency key, and its URLs have Stripe's shape so the browser-side
 * redirect check is exercised unchanged (E2E intercepts that origin).
 */
export class FakeCheckoutGateway implements CheckoutGateway {
  readonly sessions = new Map<string, FakeSession>();
  private readonly byIdempotencyKey = new Map<string, FakeSession>();
  createCalls = 0;
  /** Makes the next create call fail with this error (tests). */
  failNextCreate: Error | null = null;
  /** Awaited inside every create call (tests use it to hold a request). */
  beforeCreate: ((input: CheckoutSessionInput) => Promise<void>) | null = null;

  async createCheckoutSession(
    input: CheckoutSessionInput,
    { idempotencyKey }: { idempotencyKey: string },
  ): Promise<CreatedCheckoutSession> {
    this.createCalls += 1;
    await this.beforeCreate?.(input);
    const existing = this.byIdempotencyKey.get(idempotencyKey);
    if (existing) return toCreated(existing);

    if (this.failNextCreate) {
      const error = this.failNextCreate;
      this.failNextCreate = null;
      throw error;
    }

    const id = `cs_test_fake${randomUUID().replaceAll("-", "")}`;
    const session: FakeSession = {
      id,
      url: `${STRIPE_CHECKOUT_ORIGIN}/c/pay/${id}`,
      expiresAt: new Date(Math.floor(input.expiresAt.getTime() / 1000) * 1000),
      amountTotal:
        input.lines.reduce(
          (sum, line) => sum + line.unitPriceAmount * line.quantity,
          0,
        ) + input.shippingAmount,
      currency: "sek",
      status: "open",
      input,
    };
    this.sessions.set(id, session);
    this.byIdempotencyKey.set(idempotencyKey, session);
    return toCreated(session);
  }

  async expireCheckoutSession(sessionId: string): Promise<ExpireOutcome> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("No such checkout session");
    if (session.status === "open") session.status = "expired";
    return session.status;
  }
}

function toCreated(session: FakeSession): CreatedCheckoutSession {
  const { id, url, expiresAt, amountTotal, currency } = session;
  return { id, url, expiresAt, amountTotal, currency };
}
