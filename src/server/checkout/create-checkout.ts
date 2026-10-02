import type { PrismaClient, ShippingCarrier } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import {
  isStripeCheckoutUrl,
  type CheckoutFailure,
  type CheckoutRequest,
} from "@/lib/checkout/checkout";
import { loadCheckoutProducts } from "@/server/cart/cart-products";
import {
  holdingReservationSelect,
  holdingReservationSql,
  holdingReservationWhere,
} from "@/server/data/reservations";
import {
  isLockTimeout,
  isUniqueViolation,
  withTransactionRetry,
} from "@/server/db/transactions";
import {
  evaluateCheckout,
  exceededHoldLimit,
  MAX_HELD_UNITS_PER_CLIENT,
  matchesOrderLines,
  MIN_REUSABLE_SESSION_MS,
  provisionalHoldUntil,
  reservationHoldUntil,
  sessionExpiryFor,
} from "@/server/domain/checkout";
import { isReservationHolding } from "@/server/domain/inventory";
import { formatOrderNumber } from "@/server/domain/order-number";
import { logSafe } from "@/server/logging/safe-log";

import type {
  CheckoutGateway,
  CheckoutSessionInput,
  CreatedCheckoutSession,
} from "./gateway";

/*
 * Checkout creation (PROJECT.md §25–26, Milestone 8). Three steps, because a
 * network call to Stripe must never run inside a database transaction that
 * holds product locks:
 *
 * 1. reserve (one transaction): lock the requested product rows, validate the
 *    cart against current data, then create the PENDING order, its item
 *    snapshots and ACTIVE reservations that hold stock only briefly
 *    (PROVISIONAL_HOLD_MS).
 * 2. create the Stripe Checkout Session, idempotently per order.
 * 3. attach (one transaction): if the order is still pending and its
 *    reservations still hold, store the session ID and mark the reservations
 *    as awaiting payment. From then on only Stripe's outcome ends the hold
 *    (Milestone 9: webhooks and reconciliation); their expiresAt (session
 *    expiry plus a grace period) is when reconciliation asks Stripe.
 *
 * The customer receives the payment URL only after step 3 has committed, so
 * nobody can pay a session whose stock is not reserved. A crash between the
 * steps leaves a short provisional hold that lapses on its own; nothing
 * holds stock permanently.
 *
 * Concurrency: step 1 runs in READ COMMITTED with `SELECT … FOR UPDATE` on
 * the product rows, ordered by id (no deadlocks between checkouts). A second
 * checkout for the same product waits for the first to commit, and its
 * availability query then sees the first one's reservations, so the last
 * unit can only be reserved once. Deadlocks with other writers are retried.
 *
 * Idempotency: the browser sends a random attempt ID. Repeating an attempt
 * (double click, network retry, returning from Stripe) returns the same
 * order and, through Stripe's idempotency key `heavycards-checkout-<order
 * id>`, the same session. A new attempt names the previous one, which is
 * expired at Stripe and released, so one browser never blocks its own stock.
 *
 * Abuse (Milestone 14): a new order records its client key (the HMAC of the
 * client IP) and is refused when that client already holds as many open
 * checkouts or units as one client may (exceededHoldLimit). The check runs
 * under a per-client advisory lock, so simultaneous requests cannot exceed
 * the cap together.
 */

export const CHECKOUT_SUCCESS_PATH = "/kassa/bekraftelse";
export const CHECKOUT_CANCEL_PATH = "/kassa/avbruten";

/** Lock waits fail fast instead of piling up requests. */
const LOCK_TIMEOUT = Prisma.sql`SET LOCAL lock_timeout = '5s'`;
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 15_000 };

export type CheckoutDeps = {
  db: PrismaClient;
  gateway: CheckoutGateway;
  /** Origin for the return URLs (env APP_URL). */
  siteUrl: string;
  now?: () => Date;
};

export type CheckoutOutcome =
  | {
      ok: true;
      url: string;
      orderId: string;
      sessionId: string;
      /** An existing attempt was repeated. */
      reused: boolean;
    }
  | CheckoutFailure;

const orderSelect = {
  id: true,
  orderNumber: true,
  paymentStatus: true,
  shippingAmount: true,
  totalAmount: true,
  shippingCarrier: true,
  checkoutExpiresAt: true,
  stripeCheckoutSessionId: true,
  items: {
    select: {
      productId: true,
      productNameSnapshot: true,
      quantity: true,
      unitPriceAmount: true,
    },
    // Stable order, so a retried Stripe request has identical parameters.
    orderBy: { id: "asc" },
  },
  reservations: { select: holdingReservationSelect },
} satisfies Prisma.OrderSelect;

type CheckoutOrder = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;

type Reserved =
  | { ok: true; order: CheckoutOrder; created: boolean }
  | { ok: false; failure: CheckoutFailure };

/**
 * `clientKey` identifies the requesting client for the open-hold caps (see
 * exceededHoldLimit). Without one (scripts, tests) no cap applies.
 */
export async function createCheckout(
  deps: CheckoutDeps,
  request: CheckoutRequest,
  { clientKey = null }: { clientKey?: string | null } = {},
): Promise<CheckoutOutcome> {
  const now = (deps.now ?? (() => new Date()))();

  if (
    request.previousAttemptId &&
    request.previousAttemptId !== request.attemptId
  ) {
    try {
      await releaseAttempt(deps, request.previousAttemptId);
    } catch (error) {
      // Not fatal: the previous reservation lapses on its own.
      logCheckoutError("releasing the previous attempt failed", error);
    }
  }

  let reserved: Reserved;
  try {
    reserved = await reserveWithRetry(deps.db, request, now, clientKey);
  } catch (error) {
    if (isLockTimeout(error)) return { ok: false, code: "busy" };
    throw error;
  }
  if (!reserved.ok) return reserved.failure;
  const { order, created } = reserved;

  let session: CreatedCheckoutSession;
  try {
    session = await deps.gateway.createCheckoutSession(
      sessionInput(order, deps.siteUrl),
      { idempotencyKey: `heavycards-checkout-${order.id}` },
    );
  } catch (error) {
    logCheckoutError("creating the Stripe session failed", error, order.id);
    // Only the request that created the order releases it. A repeated
    // request failing (e.g. Stripe's concurrent-idempotency conflict) must
    // not undo the original one.
    if (created) await closeOrder(deps.db, order.id, null);
    return { ok: false, code: "payment_unavailable" };
  }

  if (
    !isStripeCheckoutUrl(session.url) ||
    session.amountTotal !== order.totalAmount ||
    session.currency !== "sek"
  ) {
    logCheckoutError("Stripe session does not match the order", null, order.id);
    await expireQuietly(deps.gateway, session.id, order.id);
    if (created) await closeOrder(deps.db, order.id, null);
    return { ok: false, code: "payment_unavailable" };
  }

  const attached = await withTransactionRetry(() =>
    attachSession(deps.db, order, session, now),
  );
  if (!attached) {
    // The order was released meanwhile (superseded or failed). This session
    // must not stay payable without reserved stock.
    await expireQuietly(deps.gateway, session.id, order.id);
    return { ok: false, code: "attempt_closed" };
  }

  return {
    ok: true,
    url: session.url,
    orderId: order.id,
    sessionId: session.id,
    reused: !created,
  };
}

async function reserveWithRetry(
  db: PrismaClient,
  request: CheckoutRequest,
  now: Date,
  clientKey: string | null,
): Promise<Reserved> {
  try {
    return await withTransactionRetry(() =>
      reserve(db, request, now, clientKey),
    );
  } catch (error) {
    // Two submissions of one new attempt raced; the loser now finds the
    // winner's order and reuses it.
    if (!isUniqueViolation(error)) throw error;
    return withTransactionRetry(() => reserve(db, request, now, clientKey));
  }
}

function reserve(
  db: PrismaClient,
  request: CheckoutRequest,
  now: Date,
  clientKey: string | null,
): Promise<Reserved> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw(LOCK_TIMEOUT);

    const findAttempt = () =>
      tx.order.findUnique({
        where: { checkoutAttemptId: request.attemptId },
        select: orderSelect,
      });
    const earlier = await findAttempt();
    if (earlier) return reuseAttempt(earlier, request, now);

    if (clientKey) {
      // Serializes this client's new checkouts (always taken before the
      // product locks, so the lock order stays global), then applies the cap.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${clientKey}, 0))`;
      // The same attempt, submitted twice at once, may have committed while
      // we waited: reuse it rather than count it against the cap.
      const raced = await findAttempt();
      if (raced) return reuseAttempt(raced, request, now);
      const limit = exceededHoldLimit(
        await openClientHolds(tx, clientKey, now),
        request.lines.reduce((sum, line) => sum + line.quantity, 0),
      );
      if (limit) {
        // A security event: which cap, never the client key or IP.
        logSafe("checkout", "info", "open-hold limit reached", { limit });
        return failure({
          ok: false,
          code: "hold_limit",
          limit,
          maxUnits: MAX_HELD_UNITS_PER_CLIENT,
        });
      }
    }

    // Lock in a global order (by id) so concurrent checkouts never deadlock.
    const productIds = request.lines.map((line) => line.productId).sort();
    await tx.$queryRaw`
      SELECT id FROM products
      WHERE id = ANY(${productIds}::uuid[])
      ORDER BY id
      FOR UPDATE`;

    // A concurrent submission of this attempt may have committed while we
    // waited for the locks.
    const concurrent = await findAttempt();
    if (concurrent) return reuseAttempt(concurrent, request, now);

    const settings = await tx.storeSettings.findUnique({
      where: { id: 1 },
      select: {
        shippingPriceAmount: true,
        freeShippingThresholdAmount: true,
        vatRateBasisPoints: true,
        defaultShippingCarrier: true,
      },
    });
    if (!settings) {
      console.error("[checkout] store settings are missing");
      return failure({ ok: false, code: "payment_unavailable" });
    }

    // Read after the locks: sees every reservation committed before ours.
    const rows = await loadCheckoutProducts(tx, productIds, now);
    const evaluation = evaluateCheckout(
      request.lines,
      new Map(rows.map((row) => [row.view.productId, row])),
      settings,
    );
    if (!evaluation.ok) {
      return failure({
        ok: false,
        code: "rejected",
        issues: evaluation.issues,
        conflict: evaluation.conflict,
      });
    }

    const { checkout } = evaluation;
    const holdUntil = provisionalHoldUntil(now);
    const order = await tx.order.create({
      data: {
        checkoutAttemptId: request.attemptId,
        checkoutClientKey: clientKey,
        checkoutExpiresAt: sessionExpiryFor(now),
        paymentStatus: "PENDING",
        currency: "SEK",
        country: "SE",
        subtotalAmount: checkout.subtotalAmount,
        shippingAmount: checkout.shippingAmount,
        taxAmount: checkout.taxAmount,
        totalAmount: checkout.totalAmount,
        // Intended carrier (PostNord in V1); tracking comes at shipping.
        shippingCarrier: settings.defaultShippingCarrier,
        items: {
          create: checkout.lines.map((line) => ({
            productId: line.productId,
            productNameSnapshot: line.name,
            skuSnapshot: line.sku,
            quantity: line.quantity,
            unitPriceAmount: line.unitPriceAmount,
            totalPriceAmount: line.totalPriceAmount,
            vatRateBasisPoints: checkout.vatRateBasisPoints,
          })),
        },
        reservations: {
          create: checkout.lines.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            status: "ACTIVE",
            expiresAt: holdUntil,
          })),
        },
      },
      select: orderSelect,
    });
    return { ok: true, order, created: true };
  }, TRANSACTION_OPTIONS);
}

/** Unpaid checkouts of this client that still hold stock, and their units. */
async function openClientHolds(
  tx: Prisma.TransactionClient,
  clientKey: string,
  now: Date,
) {
  const [row] = await tx.$queryRaw<Array<{ checkouts: number; units: number }>>`
    SELECT count(DISTINCT o.id)::int AS checkouts,
           coalesce(sum(r.quantity), 0)::int AS units
    FROM orders o
    JOIN inventory_reservations r ON r.order_id = o.id
    WHERE o.checkout_client_key = ${clientKey}
      AND o.payment_status = 'PENDING'
      AND ${holdingReservationSql(now)}`;
  return row ?? { checkouts: 0, units: 0 };
}

const failure = (value: CheckoutFailure): Reserved => ({
  ok: false,
  failure: value,
});

/**
 * A repeated attempt reuses its order only if it asks for exactly the same
 * lines at the same prices, the order is still pending, every reservation
 * still holds and the session leaves the customer time to pay. Otherwise
 * the browser must start a new attempt.
 */
function reuseAttempt(
  order: CheckoutOrder,
  request: CheckoutRequest,
  now: Date,
): Reserved {
  const reusable =
    order.paymentStatus === "PENDING" &&
    matchesOrderLines(order.items, request.lines) &&
    order.checkoutExpiresAt !== null &&
    order.checkoutExpiresAt.getTime() - now.getTime() >=
      MIN_REUSABLE_SESSION_MS &&
    order.reservations.length === order.items.length &&
    order.reservations.every((reservation) =>
      isReservationHolding(reservation, now),
    );
  return reusable
    ? { ok: true, order, created: false }
    : failure({ ok: false, code: "attempt_closed" });
}

/**
 * Step 3. Returns false (and changes nothing) if the order was released in
 * the meantime or a reservation already lapsed.
 */
function attachSession(
  db: PrismaClient,
  order: CheckoutOrder,
  session: CreatedCheckoutSession,
  now: Date,
): Promise<boolean> {
  return db
    .$transaction(async (tx) => {
      await tx.$executeRaw(LOCK_TIMEOUT);
      const [row] = await tx.$queryRaw<
        Array<{ paymentStatus: string; sessionId: string | null }>
      >`
        SELECT payment_status::text AS "paymentStatus",
               stripe_checkout_session_id AS "sessionId"
        FROM orders WHERE id = ${order.id}::uuid
        FOR UPDATE`;
      if (
        row?.paymentStatus !== "PENDING" ||
        (row.sessionId !== null && row.sessionId !== session.id)
      ) {
        return false;
      }

      // From now on the hold lasts until Stripe's outcome is applied (a paid
      // session may be reported late). expiresAt becomes the time to ask
      // Stripe if no webhook has resolved it: the session's expiry plus
      // grace. Stripe echoes our expires_at; the later of the two is used in
      // case it ever differs.
      const sessionExpiresAt = new Date(
        Math.max(
          session.expiresAt.getTime(),
          order.checkoutExpiresAt?.getTime() ?? 0,
        ),
      );
      const { count } = await tx.inventoryReservation.updateMany({
        where: { orderId: order.id, ...holdingReservationWhere(now) },
        data: {
          expiresAt: reservationHoldUntil(sessionExpiresAt),
          awaitingPayment: true,
        },
      });
      if (count !== order.reservations.length) {
        throw new ReservationLapsedError();
      }
      if (row.sessionId === null) {
        await tx.order.update({
          where: { id: order.id },
          data: { stripeCheckoutSessionId: session.id },
        });
      }
      return true;
    }, TRANSACTION_OPTIONS)
    .catch((error: unknown) => {
      if (error instanceof ReservationLapsedError) return false;
      throw error;
    });
}

class ReservationLapsedError extends Error {
  constructor() {
    super("A reservation lapsed before the session was attached");
    this.name = "ReservationLapsedError";
  }
}

/**
 * Releases a pending order's reservations and marks it EXPIRED, but only if
 * it is still PENDING with exactly `expectedSessionId` attached (null: no
 * session yet). The row lock makes this and attachSession mutually
 * exclusive, so a session is never attached to a released order.
 */
export async function closeOrder(
  db: PrismaClient,
  orderId: string,
  expectedSessionId: string | null,
): Promise<boolean> {
  return withTransactionRetry(() =>
    db.$transaction(async (tx) => {
      await tx.$executeRaw(LOCK_TIMEOUT);
      const [row] = await tx.$queryRaw<
        Array<{ paymentStatus: string; sessionId: string | null }>
      >`
        SELECT payment_status::text AS "paymentStatus",
               stripe_checkout_session_id AS "sessionId"
        FROM orders WHERE id = ${orderId}::uuid
        FOR UPDATE`;
      if (
        row?.paymentStatus !== "PENDING" ||
        row.sessionId !== expectedSessionId
      ) {
        return false;
      }
      await tx.inventoryReservation.updateMany({
        where: { orderId, status: "ACTIVE" },
        data: { status: "RELEASED" },
      });
      await tx.order.update({
        where: { id: orderId },
        data: { paymentStatus: "EXPIRED", checkoutClientKey: null },
      });
      return true;
    }, TRANSACTION_OPTIONS),
  );
}

/**
 * Supersedes the browser's previous attempt: its Stripe session is expired
 * first (so it can no longer be paid), then its stock is released. A
 * session the customer already completed is left for payment processing.
 */
async function releaseAttempt(
  deps: CheckoutDeps,
  attemptId: string,
): Promise<void> {
  const order = await deps.db.order.findUnique({
    where: { checkoutAttemptId: attemptId },
    select: { id: true, paymentStatus: true, stripeCheckoutSessionId: true },
  });
  if (!order || order.paymentStatus !== "PENDING") return;

  const sessionId = order.stripeCheckoutSessionId;
  if (sessionId) {
    const outcome = await deps.gateway.expireCheckoutSession(sessionId);
    if (outcome !== "expired") return;
  }
  await closeOrder(deps.db, order.id, sessionId);
}

async function expireQuietly(
  gateway: CheckoutGateway,
  sessionId: string,
  orderId: string,
) {
  try {
    await gateway.expireCheckoutSession(sessionId);
  } catch (error) {
    // The session's own expiry still ends it; log for follow-up.
    logCheckoutError("expiring an orphaned session failed", error, orderId);
  }
}

const carrierLabels: Readonly<Record<ShippingCarrier, string>> = {
  POSTNORD: "PostNord",
  OTHER: "Frakt",
};

function sessionInput(
  order: CheckoutOrder,
  siteUrl: string,
): CheckoutSessionInput {
  if (!order.checkoutExpiresAt) {
    throw new Error("Checkout order without a session expiry");
  }
  return {
    orderId: order.id,
    orderNumber: formatOrderNumber(order.orderNumber),
    lines: order.items.map((item) => ({
      name: item.productNameSnapshot,
      quantity: item.quantity,
      unitPriceAmount: item.unitPriceAmount,
    })),
    shippingAmount: order.shippingAmount,
    shippingLabel: carrierLabels[order.shippingCarrier ?? "POSTNORD"],
    totalAmount: order.totalAmount,
    expiresAt: order.checkoutExpiresAt,
    // Stripe replaces {CHECKOUT_SESSION_ID}; the return pages never trust
    // it for payment state (they read the order from the database).
    successUrl: `${siteUrl}${CHECKOUT_SUCCESS_PATH}?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${siteUrl}${CHECKOUT_CANCEL_PATH}`,
  };
}

/**
 * Logs without personal data, secrets or provider messages: the error's
 * name, Stripe's error type/code and request ID when present, and our own
 * order ID.
 */
export function logCheckoutError(
  message: string,
  error: unknown,
  orderId?: string,
) {
  const details =
    error && typeof error === "object"
      ? (error as {
          name?: unknown;
          type?: unknown;
          code?: unknown;
          requestId?: unknown;
        })
      : {};
  console.error(`[checkout] ${message}`, {
    orderId,
    error: typeof details.name === "string" ? details.name : undefined,
    type: typeof details.type === "string" ? details.type : undefined,
    code: typeof details.code === "string" ? details.code : undefined,
    requestId:
      typeof details.requestId === "string" ? details.requestId : undefined,
  });
}
