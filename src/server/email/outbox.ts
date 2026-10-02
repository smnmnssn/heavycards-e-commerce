import {
  Prisma,
  type EmailKind,
  type PrismaClient,
} from "@/generated/prisma/client";
import {
  EmailDeliveryError,
  type EmailMessage,
  type EmailTransport,
} from "@/lib/email/transport";
import {
  CONFIRMATION_PAYMENT_STATES,
  decideAfterFailure,
  deliveryEligibility,
  emailIdempotencyKey,
  providerWindowExpired,
  SEND_LEASE_MS,
} from "@/server/domain/email-delivery";
import type { ReviewLinkKey } from "@/server/domain/review-token";
import { reviewLinkFor } from "@/server/reviews/invitations";

import { logEmail } from "./log";
import {
  orderConfirmationEmail,
  orderShippedEmail,
  type OrderEmailData,
  type ShippedEmailOptions,
} from "./order-templates";

/*
 * Transactional email outbox (PROJECT.md §32, §39, §40).
 *
 * 1. A business transaction that creates an email obligation (an order
 *    becomes PAID, an order first becomes SHIPPED) calls `enqueueOrderEmail`
 *    inside that same transaction. The EmailDelivery row commits or rolls
 *    back together with the state change; unique (orderId, kind) means each
 *    order has at most one confirmation and one shipping email.
 * 2. After the commit, `dispatchEmailDelivery` sends it, never inside a
 *    database transaction:
 *      claim (one atomic UPDATE: lease + attempt number)
 *      → render from the order's stored snapshots
 *      → send with the deterministic idempotency key
 *      → record SENT (and the order's *EmailSentAt marker) or the failure.
 *    Immediate sends (after a webhook), the scheduled run and retries all go
 *    through this one function.
 *
 * Exactly once for the customer:
 * - concurrent dispatchers: only one UPDATE can take the lease;
 * - a SENT row is never claimed again (replays, repeated runs, re-saves);
 * - unknown outcomes (timeout, 5xx, a crash that let the lease lapse) are
 *   retried with the same idempotency key, which the provider deduplicates
 *   for 24 hours; after that window the row becomes FAILED for a person
 *   rather than risking a second email (src/server/domain/email-delivery.ts);
 * - an email failure never touches the order's payment or fulfillment.
 */

export type EmailDeps = {
  db: PrismaClient;
  transport: EmailTransport;
  /** Public origin for links in emails. */
  siteUrl: string;
  /** Re-derives the review link of shipping emails (never stored). */
  reviewLinkKey: ReviewLinkKey;
  now?: () => Date;
};

export type DispatchOutcome =
  /** Accepted by the provider. */
  | "sent"
  /** Failed; scheduled for another attempt. */
  | "retry_scheduled"
  /** Needs a person; no further automatic attempts. */
  | "failed"
  /** No longer applicable (e.g. the order was fully refunded). */
  | "cancelled"
  /** Not pending, not due yet, or another dispatcher holds it. */
  | "not_claimed"
  /** Our lease lapsed and another dispatcher took over; it records the result. */
  | "superseded";

export const EMAIL_AUDIT_ACTIONS = {
  attention: "EMAIL_NEEDS_ATTENTION",
} as const;

type Tx = Prisma.TransactionClient;

const SENT_MARKER = {
  ORDER_CONFIRMATION: "confirmationEmailSentAt",
  ORDER_SHIPPED: "shippingEmailSentAt",
} as const satisfies Record<EmailKind, keyof Prisma.OrderUpdateInput>;

/**
 * Records the obligation to send `kind` for an order, inside the caller's
 * transaction. Idempotent: an existing obligation is kept as it is.
 * Returns the delivery's ID.
 */
export async function enqueueOrderEmail(
  tx: Tx,
  orderId: string,
  kind: EmailKind,
  now: Date,
): Promise<string> {
  // ON CONFLICT DO NOTHING: never aborts the surrounding transaction.
  await tx.emailDelivery.createMany({
    data: [{ orderId, kind, nextAttemptAt: now, createdAt: now }],
    skipDuplicates: true,
  });
  const { id } = await tx.emailDelivery.findUniqueOrThrow({
    where: { orderId_kind: { orderId, kind } },
    select: { id: true },
  });
  return id;
}

type Claim = {
  id: string;
  orderId: string;
  kind: EmailKind;
  /** This attempt's number; also the token that proves we hold the lease. */
  attempts: number;
  /** When this attempt started. */
  startedAt: Date;
  outcomeUnknownSince: Date | null;
};

/**
 * Takes the delivery for one attempt, atomically. Fails (returns null) when
 * it is not pending, not due, or leased to another live dispatcher. If the
 * previous lease lapsed without a recorded result, that attempt's outcome
 * is unknown, which starts the provider-window clock.
 */
async function claim(
  db: PrismaClient,
  deliveryId: string,
  now: Date,
): Promise<Claim | null> {
  const leaseEnd = new Date(now.getTime() + SEND_LEASE_MS);
  const [row] = await db.$queryRaw<Claim[]>`
    UPDATE email_deliveries
    SET attempts = attempts + 1,
        last_attempt_at = ${now},
        locked_until = ${leaseEnd},
        outcome_unknown_since = CASE
          WHEN locked_until IS NOT NULL
            THEN COALESCE(outcome_unknown_since, last_attempt_at)
          ELSE outcome_unknown_since
        END,
        updated_at = ${now}
    WHERE id = ${deliveryId}::uuid
      AND status = 'PENDING'
      AND next_attempt_at <= ${now}
      AND (locked_until IS NULL OR locked_until <= ${now})
    RETURNING id::text AS id,
              order_id::text AS "orderId",
              kind::text AS kind,
              attempts,
              last_attempt_at AS "startedAt",
              outcome_unknown_since AS "outcomeUnknownSince"`;
  return row ?? null;
}

/** Sends one delivery if it is due. Safe to call repeatedly and concurrently. */
export async function dispatchEmailDelivery(
  deps: EmailDeps,
  deliveryId: string,
): Promise<DispatchOutcome> {
  const clock = deps.now ?? (() => new Date());
  const claimed = await claim(deps.db, deliveryId, clock());
  if (!claimed) return "not_claimed";
  const log = {
    deliveryId,
    orderId: claimed.orderId,
    kind: claimed.kind,
    attempt: claimed.attempts,
  };

  if (providerWindowExpired(claimed.outcomeUnknownSince, clock())) {
    return giveUp(deps.db, claimed, "outcome_unknown", log);
  }

  let prepared: Prepared;
  try {
    prepared = await prepareMessage(deps, claimed);
  } catch (error) {
    // Nothing was sent: a database problem or missing store settings.
    logEmail("error", "email could not be prepared", { ...log, error });
    return recordFailure(
      deps,
      claimed,
      new EmailDeliveryError("prepare_failed", "not_sent"),
      log,
    );
  }
  if (!prepared.ok) {
    return prepared.cancel
      ? finish(deps.db, claimed, "CANCELLED", prepared.reason, log)
      : giveUp(deps.db, claimed, prepared.reason, log);
  }

  let providerMessageId: string | null;
  try {
    ({ providerMessageId } = await deps.transport.send(prepared.message, {
      idempotencyKey: emailIdempotencyKey(claimed.kind, claimed.orderId),
    }));
  } catch (error) {
    const failure =
      error instanceof EmailDeliveryError
        ? error
        : new EmailDeliveryError("transport_error", "unknown");
    return recordFailure(deps, claimed, failure, log);
  }
  return recordSent(deps, claimed, providerMessageId, log);
}

type Prepared =
  | { ok: true; message: EmailMessage }
  | { ok: false; cancel: boolean; reason: string };

/**
 * Renders the email from the order as stored now. The recipient is always
 * the finalized order's own email address; nothing from a request can
 * choose it.
 */
async function prepareMessage(
  deps: EmailDeps,
  claimed: Claim,
): Promise<Prepared> {
  const order = await deps.db.order.findUniqueOrThrow({
    where: { id: claimed.orderId },
    select: {
      orderNumber: true,
      email: true,
      customerName: true,
      paidAt: true,
      paymentStatus: true,
      fulfillmentStatus: true,
      subtotalAmount: true,
      shippingAmount: true,
      taxAmount: true,
      totalAmount: true,
      addressLine1: true,
      addressLine2: true,
      postalCode: true,
      city: true,
      shippingCarrier: true,
      trackingNumber: true,
      confirmationEmailSentAt: true,
      shippingEmailSentAt: true,
      reviewToken: {
        select: {
          nonce: true,
          tokenHash: true,
          expiresAt: true,
          revokedAt: true,
        },
      },
      items: {
        select: {
          productNameSnapshot: true,
          quantity: true,
          unitPriceAmount: true,
          totalPriceAmount: true,
        },
        // Deterministic, so a retry renders the identical message.
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });

  const eligibility = deliveryEligibility(claimed.kind, order);
  if (!eligibility.ok) {
    return { ok: false, cancel: true, reason: eligibility.reason };
  }
  if (order[SENT_MARKER[claimed.kind]]) {
    // Sent before this outbox existed (marker set by earlier code or data).
    return { ok: false, cancel: true, reason: "already_sent" };
  }
  const { email, customerName, paidAt, addressLine1, postalCode, city } = order;
  if (
    !email ||
    !customerName ||
    !paidAt ||
    !addressLine1 ||
    !postalCode ||
    !city
  ) {
    // Impossible for a paid order (CHECK constraint); never guess a recipient.
    return { ok: false, cancel: false, reason: "missing_customer_data" };
  }

  const store = await deps.db.storeSettings.findUnique({
    where: { id: 1 },
    select: {
      storeName: true,
      contactEmail: true,
      companyName: true,
      organizationNumber: true,
    },
  });
  if (!store) throw new Error("Store settings are missing");

  const data: OrderEmailData = {
    orderNumber: order.orderNumber,
    customerName,
    email,
    paidAt,
    items: order.items.map((item) => ({
      name: item.productNameSnapshot,
      quantity: item.quantity,
      unitPriceAmount: item.unitPriceAmount,
      totalPriceAmount: item.totalPriceAmount,
    })),
    subtotalAmount: order.subtotalAmount,
    shippingAmount: order.shippingAmount,
    taxAmount: order.taxAmount,
    totalAmount: order.totalAmount,
    address: {
      line1: addressLine1,
      line2: order.addressLine2,
      postalCode,
      city,
    },
    shippingCarrier: order.shippingCarrier,
    trackingNumber: order.trackingNumber,
  };
  const storeInfo = { ...store, siteUrl: deps.siteUrl };
  return {
    ok: true,
    message:
      claimed.kind === "ORDER_CONFIRMATION"
        ? orderConfirmationEmail(data, storeInfo)
        : orderShippedEmail(
            data,
            storeInfo,
            shippedEmailOptions(deps, claimed, order.reviewToken),
          ),
  };
}

/**
 * The review section of a shipping email. The URL is re-derived from the
 * stored invitation on every render, so a retry sends the identical
 * message (same idempotency key, same payload) and never a new link. Orders
 * shipped before Milestone 11 have no invitation and get no section.
 */
function shippedEmailOptions(
  deps: EmailDeps,
  claimed: Claim,
  invitation: Parameters<typeof reviewLinkFor>[0] | null,
): ShippedEmailOptions {
  if (!invitation) return {};
  const link = reviewLinkFor(invitation, {
    reviewLinkKey: deps.reviewLinkKey,
    siteUrl: deps.siteUrl,
    now: (deps.now ?? (() => new Date()))(),
  });
  if (link.ok) return { review: { url: link.url } };
  if (link.reason === "key_mismatch") {
    // AUTH_SECRET changed after shipping: the stored hash cannot be matched
    // any more, so the email goes out without a (non-working) link.
    logEmail("error", "review link unavailable", {
      deliveryId: claimed.id,
      orderId: claimed.orderId,
      problem: "review_link_key_mismatch",
    });
  }
  return {};
}

/** Only the holder of the current attempt may record its result. */
const heldBy = (claimed: Claim) => ({
  id: claimed.id,
  status: "PENDING" as const,
  attempts: claimed.attempts,
});

async function recordSent(
  deps: EmailDeps,
  claimed: Claim,
  providerMessageId: string | null,
  log: Record<string, unknown>,
): Promise<DispatchOutcome> {
  const sentAt = (deps.now ?? (() => new Date()))();
  const recorded = await deps.db.$transaction(async (tx) => {
    const updated = await tx.emailDelivery.updateMany({
      where: heldBy(claimed),
      data: {
        status: "SENT",
        sentAt,
        providerMessageId: providerMessageId?.slice(0, 255) ?? null,
        lockedUntil: null,
        lastError: null,
      },
    });
    if (updated.count === 0) return false;
    await tx.order.updateMany({
      where: { id: claimed.orderId, [SENT_MARKER[claimed.kind]]: null },
      data: { [SENT_MARKER[claimed.kind]]: sentAt },
    });
    return true;
  });
  if (!recorded) {
    // Our lease lapsed mid-send and another dispatcher retried with the same
    // idempotency key; the provider returns it the same email.
    logEmail("error", "email sent after lease lapsed", {
      ...log,
      outcome: "superseded",
    });
    return "superseded";
  }
  logEmail("info", "email sent", {
    ...log,
    outcome: "sent",
    providerMessageId: providerMessageId ?? undefined,
  });
  return "sent";
}

async function recordFailure(
  deps: EmailDeps,
  claimed: Claim,
  error: EmailDeliveryError,
  log: Record<string, unknown>,
): Promise<DispatchOutcome> {
  const now = (deps.now ?? (() => new Date()))();
  const decision = decideAfterFailure({
    attempts: claimed.attempts,
    failure: error.failure,
    code: error.code,
    now,
  });
  // The provider may have accepted it: from now on only the idempotency
  // key protects against a duplicate, and only within its window.
  const outcomeUnknownSince =
    error.failure === "not_sent"
      ? claimed.outcomeUnknownSince
      : (claimed.outcomeUnknownSince ?? claimed.startedAt);

  if (decision.action === "give_up") {
    return giveUp(deps.db, claimed, decision.problem, log, {
      lastError: error.code,
      outcomeUnknownSince,
    });
  }
  const updated = await deps.db.emailDelivery.updateMany({
    where: heldBy(claimed),
    data: {
      lockedUntil: null,
      nextAttemptAt: decision.nextAttemptAt,
      lastError: error.code,
      outcomeUnknownSince,
    },
  });
  logEmail("error", "email delivery failed; will retry", {
    ...log,
    outcome: updated.count > 0 ? "retry_scheduled" : "superseded",
    errorCode: error.code,
    failure: error.failure,
    nextAttemptAt: decision.nextAttemptAt.toISOString(),
  });
  return updated.count > 0 ? "retry_scheduled" : "superseded";
}

/** Ends automatic delivery and leaves a system audit entry for staff. */
const giveUp = (
  db: PrismaClient,
  claimed: Claim,
  problem: string,
  log: Record<string, unknown>,
  extra: FinishExtra = {},
) => finish(db, claimed, "FAILED", problem, log, extra);

type FinishExtra = { lastError?: string; outcomeUnknownSince?: Date | null };

/** FAILED (with an audit entry for staff) or CANCELLED; both are final. */
async function finish(
  db: PrismaClient,
  claimed: Claim,
  status: "FAILED" | "CANCELLED",
  reason: string,
  log: Record<string, unknown>,
  extra: FinishExtra = {},
): Promise<DispatchOutcome> {
  const done = await db.$transaction(async (tx) => {
    const updated = await tx.emailDelivery.updateMany({
      where: heldBy(claimed),
      data: {
        status,
        lockedUntil: null,
        lastError: status === "FAILED" ? (extra.lastError ?? reason) : reason,
        ...(extra.outcomeUnknownSince !== undefined && {
          outcomeUnknownSince: extra.outcomeUnknownSince,
        }),
      },
    });
    if (updated.count === 0) return false;
    if (status === "FAILED") {
      await tx.auditLog.create({
        data: {
          adminUserId: null,
          action: EMAIL_AUDIT_ACTIONS.attention,
          entityType: "Order",
          entityId: claimed.orderId,
          metadata: {
            kind: claimed.kind,
            problem: reason,
            deliveryId: claimed.id,
            attempts: claimed.attempts,
          },
        },
      });
    }
    return true;
  });
  if (!done) return "superseded";
  const outcome = status === "FAILED" ? "failed" : "cancelled";
  logEmail(status === "FAILED" ? "error" : "info", `email ${outcome}`, {
    ...log,
    outcome,
    problem: reason,
  });
  return outcome;
}

export type EmailRunSummary = {
  enqueued: number;
  attempted: number;
  outcomes: Partial<Record<DispatchOutcome | "error", number>>;
};

/**
 * Dispatches due deliveries, oldest first, one at a time. With `orderId`,
 * only that order's (used right after a webhook or a status change).
 */
export async function processDueEmails(
  deps: EmailDeps,
  { limit = 25, orderId }: { limit?: number; orderId?: string } = {},
): Promise<EmailRunSummary> {
  const now = (deps.now ?? (() => new Date()))();
  const due = await deps.db.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id
    FROM email_deliveries
    WHERE status = 'PENDING'
      AND next_attempt_at <= ${now}
      AND (locked_until IS NULL OR locked_until <= ${now})
      ${orderId ? Prisma.sql`AND order_id = ${orderId}::uuid` : Prisma.empty}
    ORDER BY next_attempt_at
    LIMIT ${limit}`;

  const summary: EmailRunSummary = { enqueued: 0, attempted: 0, outcomes: {} };
  for (const { id } of due) {
    summary.attempted += 1;
    let outcome: DispatchOutcome | "error";
    try {
      outcome = await dispatchEmailDelivery(deps, id);
    } catch (error) {
      // A database error around the attempt. If it happened after sending,
      // the lease lapses and the retry reuses the idempotency key.
      outcome = "error";
      logEmail("error", "email dispatch failed", { deliveryId: id, error });
    }
    summary.outcomes[outcome] = (summary.outcomes[outcome] ?? 0) + 1;
  }
  return summary;
}

/**
 * Safety net for paid orders without a confirmation obligation: orders paid
 * before this outbox existed (Milestone 9), or any future code path that
 * marks an order paid without enqueueing. Idempotent; concurrent runs
 * cannot create a second row (unique order and kind).
 */
export async function enqueueMissingOrderConfirmations(
  db: PrismaClient,
  { now, limit = 100 }: { now: Date; limit?: number },
): Promise<number> {
  const missing = await db.$queryRaw<Array<{ id: string }>>`
    SELECT o.id::text AS id
    FROM orders o
    WHERE o.payment_status::text IN (${Prisma.join([...CONFIRMATION_PAYMENT_STATES])})
      AND o.confirmation_email_sent_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM email_deliveries d
        WHERE d.order_id = o.id AND d.kind = 'ORDER_CONFIRMATION'
      )
    ORDER BY o.paid_at
    LIMIT ${limit}`;
  if (missing.length === 0) return 0;
  const { count } = await db.emailDelivery.createMany({
    data: missing.map(({ id }) => ({
      orderId: id,
      kind: "ORDER_CONFIRMATION" as const,
      nextAttemptAt: now,
      createdAt: now,
    })),
    skipDuplicates: true,
  });
  if (count > 0) {
    logEmail("info", "missing order confirmations enqueued", { count });
  }
  return count;
}

/** The scheduled email step: the sweep, then every due delivery. */
export async function runEmailJobs(
  deps: EmailDeps,
  { limit = 25 }: { limit?: number } = {},
): Promise<EmailRunSummary> {
  const now = (deps.now ?? (() => new Date()))();
  const enqueued = await enqueueMissingOrderConfirmations(deps.db, { now });
  const summary = await processDueEmails(deps, { limit });
  return { ...summary, enqueued };
}
