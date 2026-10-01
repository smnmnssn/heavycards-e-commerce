import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { STRIPE_CHECKOUT_ORIGIN } from "@/lib/checkout/checkout";
import {
  succeededRefundTotal,
  type CheckoutSessionState,
} from "@/server/domain/payment";

import type {
  CheckoutGateway,
  CheckoutSessionInput,
  CreatedCheckoutSession,
  ExpireOutcome,
} from "./gateway";

export type FakeRefundStatus =
  "pending" | "requires_action" | "succeeded" | "failed" | "canceled";

export type FakeRefund = {
  id: string;
  amount: number;
  status: FakeRefundStatus;
  currency: string;
};

/** A fake session: the provider-neutral state plus bookkeeping. */
export type FakeSession = CheckoutSessionState & {
  url: string;
  expiresAt: string;
  /** Refunds of its payment, in every state, like Stripe's refund list. */
  refunds: FakeRefund[];
  orderId: string;
  /** What checkout asked for (tests inspect it). */
  input: CheckoutSessionInput;
};

export const FAKE_CUSTOMER = {
  shippingName: "Kim Kund",
  name: "Kim Kund",
  email: "kund@example.com",
  phone: "+46701234567",
} as const;

export const FAKE_SHIPPING_ADDRESS = {
  line1: "Testgatan 1",
  line2: null,
  postalCode: "111 22",
  city: "Stockholm",
  country: "SE",
} as const;

/**
 * In-memory stand-in for Stripe Checkout, used by database tests and local
 * E2E runs (PAYMENT_GATEWAY=fake, refused on Vercel). It never makes network
 * requests. Like Stripe, it returns the same session for a repeated
 * idempotency key, and its URLs have Stripe's shape so the browser-side
 * redirect check is exercised unchanged (E2E intercepts that origin).
 *
 * With a state directory, every session is also kept as
 * `<dir>/<session id>.json` and read back on each retrieval, so E2E tests can
 * play "Stripe" by editing that file (for example marking it paid) and then
 * sending a signed webhook (e2e/checkout-fixtures.ts).
 */
export class FakeCheckoutGateway implements CheckoutGateway {
  private readonly sessions = new Map<string, FakeSession>();
  private readonly byIdempotencyKey = new Map<string, string>();
  createCalls = 0;
  retrieveCalls = 0;
  /** Makes the next create call fail with this error (tests). */
  failNextCreate: Error | null = null;
  /** Simulates Stripe being unreachable for every read (tests). */
  unavailable = false;
  /** Awaited inside every create call (tests use it to hold a request). */
  beforeCreate: ((input: CheckoutSessionInput) => Promise<void>) | null = null;

  constructor(private readonly stateDir: string | null = null) {
    if (stateDir) mkdirSync(stateDir, { recursive: true });
  }

  async createCheckoutSession(
    input: CheckoutSessionInput,
    { idempotencyKey }: { idempotencyKey: string },
  ): Promise<CreatedCheckoutSession> {
    this.createCalls += 1;
    await this.beforeCreate?.(input);
    const existingId = this.byIdempotencyKey.get(idempotencyKey);
    if (existingId) return toCreated(this.session(existingId)!);

    if (this.failNextCreate) {
      const error = this.failNextCreate;
      this.failNextCreate = null;
      throw error;
    }

    const id = `cs_test_fake${randomUUID().replaceAll("-", "")}`;
    const session: FakeSession = {
      id,
      url: `${STRIPE_CHECKOUT_ORIGIN}/c/pay/${id}`,
      expiresAt: new Date(
        Math.floor(input.expiresAt.getTime() / 1000) * 1000,
      ).toISOString(),
      status: "open",
      paymentStatus: "unpaid",
      amountTotal:
        input.lines.reduce(
          (sum, line) => sum + line.unitPriceAmount * line.quantity,
          0,
        ) + input.shippingAmount,
      currency: "sek",
      paymentIntent: null,
      customer: { shippingName: null, name: null, email: null, phone: null },
      shippingAddress: null,
      refunds: [],
      orderId: input.orderId,
      input,
    };
    this.save(session);
    this.byIdempotencyKey.set(idempotencyKey, id);
    return toCreated(session);
  }

  async expireCheckoutSession(sessionId: string): Promise<ExpireOutcome> {
    this.assertAvailable();
    const session = this.session(sessionId);
    if (!session) throw new Error("No such checkout session");
    if (session.status === "open") {
      this.save({ ...session, status: "expired" });
      return "expired";
    }
    return session.status === "complete" ? "complete" : "expired";
  }

  async retrieveCheckoutSession(
    sessionId: string,
  ): Promise<CheckoutSessionState> {
    this.retrieveCalls += 1;
    this.assertAvailable();
    const session = this.session(sessionId);
    if (!session) throw new Error("No such checkout session");
    return toState(session);
  }

  async findCheckoutSessionIdForPayment(
    paymentIntentId: string,
  ): Promise<string | null> {
    this.assertAvailable();
    return this.byPayment(paymentIntentId)?.id ?? null;
  }

  async retrieveRefundedAmount(
    paymentIntentId: string,
  ): Promise<{ amountRefunded: number; currency: string }> {
    this.assertAvailable();
    const session = this.byPayment(paymentIntentId);
    if (!session) throw new Error("No such payment");
    // The same rule as the Stripe gateway: only succeeded refunds count.
    return succeededRefundTotal(session.refunds ?? []);
  }

  // --- Test controls ("what happened at Stripe") ---------------------------------

  /** The customer paid (or, with `async`, started a delayed payment). */
  completeSession(
    sessionId: string,
    options: {
      async?: boolean;
      customer?: Partial<FakeSession["customer"]>;
      shippingAddress?: Partial<
        NonNullable<FakeSession["shippingAddress"]>
      > | null;
      amountTotal?: number;
      currency?: string;
      paidAt?: Date;
    } = {},
  ): FakeSession {
    const session = this.requireSession(sessionId);
    const updated: FakeSession = {
      ...session,
      status: "complete",
      paymentStatus: options.async ? "unpaid" : "paid",
      amountTotal: options.amountTotal ?? session.amountTotal,
      currency: options.currency ?? session.currency,
      paymentIntent: {
        id:
          session.paymentIntent?.id ??
          `pi_test_fake${randomUUID().slice(0, 8)}`,
        status: options.async ? "processing" : "succeeded",
        paidAt: options.async ? null : (options.paidAt ?? new Date()),
      },
      customer: { ...FAKE_CUSTOMER, ...options.customer },
      shippingAddress:
        options.shippingAddress === null
          ? null
          : { ...FAKE_SHIPPING_ADDRESS, ...options.shippingAddress },
    };
    this.save(updated);
    return updated;
  }

  /** A delayed payment settled. */
  settleAsyncPayment(sessionId: string, succeeded: boolean): FakeSession {
    const session = this.requireSession(sessionId);
    const updated: FakeSession = {
      ...session,
      paymentStatus: succeeded ? "paid" : "unpaid",
      paymentIntent: {
        id: session.paymentIntent!.id,
        status: succeeded ? "succeeded" : "requires_payment_method",
        paidAt: succeeded ? new Date() : null,
      },
    };
    this.save(updated);
    return updated;
  }

  /** Stripe expired the session itself (time ran out). */
  expireAtStripe(sessionId: string): FakeSession {
    const updated: FakeSession = {
      ...this.requireSession(sessionId),
      status: "expired",
    };
    this.save(updated);
    return updated;
  }

  /** A refund is created on the session's payment (Dashboard); its ID. */
  addRefund(
    sessionId: string,
    amount: number,
    status: FakeRefundStatus = "succeeded",
  ): string {
    const session = this.requireSession(sessionId);
    const refund: FakeRefund = {
      id: `re_test_fake${randomUUID().slice(0, 8)}`,
      amount,
      status,
      currency: "sek",
    };
    this.save({ ...session, refunds: [...(session.refunds ?? []), refund] });
    return refund.id;
  }

  /** A refund moves to another state (succeeds, fails, is cancelled). */
  setRefundStatus(
    sessionId: string,
    refundId: string,
    status: FakeRefundStatus,
  ): void {
    const session = this.requireSession(sessionId);
    if (!session.refunds.some((refund) => refund.id === refundId)) {
      throw new Error("No such refund");
    }
    this.save({
      ...session,
      refunds: session.refunds.map((refund) =>
        refund.id === refundId ? { ...refund, status } : refund,
      ),
    });
  }

  session(sessionId: string): FakeSession | undefined {
    if (this.stateDir && /^cs_test_fake[0-9a-f]+$/.test(sessionId)) {
      try {
        return JSON.parse(
          readFileSync(join(this.stateDir, `${sessionId}.json`), "utf8"),
        ) as FakeSession;
      } catch {
        return undefined;
      }
    }
    return this.sessions.get(sessionId);
  }

  // --- Internals ------------------------------------------------------------------

  private requireSession(sessionId: string): FakeSession {
    const session = this.session(sessionId);
    if (!session) throw new Error("No such checkout session");
    return session;
  }

  private byPayment(paymentIntentId: string): FakeSession | undefined {
    return this.allSessions().find(
      (session) => session.paymentIntent?.id === paymentIntentId,
    );
  }

  allSessions(): FakeSession[] {
    if (!this.stateDir) return [...this.sessions.values()];
    return readdirSync(this.stateDir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => this.session(file.slice(0, -5)))
      .filter((session): session is FakeSession => Boolean(session));
  }

  private save(session: FakeSession) {
    this.sessions.set(session.id, session);
    if (this.stateDir) {
      // Recreated if a test run removed it while the server kept running.
      mkdirSync(this.stateDir, { recursive: true });
      writeFileSync(
        join(this.stateDir, `${session.id}.json`),
        JSON.stringify(session, null, 2),
      );
    }
  }

  private assertAvailable() {
    if (this.unavailable) {
      throw Object.assign(new Error("Stripe is unavailable (fake)"), {
        type: "StripeConnectionError",
      });
    }
  }
}

function toCreated(session: FakeSession): CreatedCheckoutSession {
  return {
    id: session.id,
    url: session.url,
    expiresAt: new Date(session.expiresAt),
    amountTotal: session.amountTotal,
    currency: session.currency,
  };
}

function toState(session: FakeSession): CheckoutSessionState {
  return {
    id: session.id,
    status: session.status,
    paymentStatus: session.paymentStatus,
    amountTotal: session.amountTotal,
    currency: session.currency,
    paymentIntent: session.paymentIntent
      ? {
          ...session.paymentIntent,
          paidAt: session.paymentIntent.paidAt
            ? new Date(session.paymentIntent.paidAt)
            : null,
        }
      : null,
    customer: session.customer,
    shippingAddress: session.shippingAddress,
  };
}
