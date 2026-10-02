import type { EmailKind, PrismaClient } from "@/generated/prisma/client";
import { lockActiveAdmin } from "@/server/admin/access";
import { deliveryEligibility } from "@/server/domain/email-delivery";

/*
 * Operator procedure: give a FAILED order email one more automatic delivery
 * (Milestone 14). A delivery becomes FAILED when the outbox can no longer
 * rule out a duplicate (an unknown outcome past the provider's 24-hour
 * idempotency window, an idempotency conflict) or after its last retry
 * (src/server/email/outbox.ts). Only a person can tell from the Resend
 * dashboard whether the customer actually received it, so this is never
 * automatic and never an admin button.
 *
 * Earlier documentation said to set the row back to PENDING by hand. That
 * did not work for unknown outcomes: the next claim saw the old
 * `outcome_unknown_since` and failed the row again at once, and `attempts`
 * left no retries. This resets the delivery as a new obligation (attempts,
 * unknown-outcome clock, lease, error) in one guarded update, for an
 * active OWNER only, with an OPERATOR_REQUEUE_EMAIL audit entry.
 *
 * The idempotency key stays `<kind>/<order id>`: within 24 hours of the
 * last attempt Resend would return the earlier result (or a conflict, if
 * the content changed) instead of sending, which is the safe direction.
 */

export const REQUEUE_EMAIL_AUDIT_ACTION = "OPERATOR_REQUEUE_EMAIL";

export type RequeueEmailResult =
  | { ok: true; orderId: string; deliveryId: string }
  | {
      ok: false;
      error:
        | "NOT_FOUND"
        /** Only FAILED deliveries are requeued. */
        | "NOT_FAILED"
        /** The order already records this email as sent. */
        | "ALREADY_SENT"
        /** The order no longer qualifies (e.g. fully refunded, not shipped). */
        | "NOT_ELIGIBLE";
      detail?: string;
    };

export async function requeueFailedEmail(
  db: PrismaClient,
  {
    actorId,
    orderNumber,
    kind,
    now = new Date(),
  }: { actorId: string; orderNumber: number; kind: EmailKind; now?: Date },
): Promise<RequeueEmailResult> {
  return db.$transaction(async (tx) => {
    await lockActiveAdmin(
      tx,
      actorId,
      (admin) => admin.role === "OWNER",
      "Endast en aktiv ägare (OWNER) kan skicka om e-post.",
    );
    const order = await tx.order.findUnique({
      where: { orderNumber },
      select: {
        id: true,
        paymentStatus: true,
        fulfillmentStatus: true,
        confirmationEmailSentAt: true,
        shippingEmailSentAt: true,
        emailDeliveries: {
          where: { kind },
          select: { id: true, status: true, attempts: true, lastError: true },
        },
      },
    });
    const delivery = order?.emailDeliveries[0];
    if (!order || !delivery) return { ok: false, error: "NOT_FOUND" } as const;
    if (delivery.status !== "FAILED") {
      return { ok: false, error: "NOT_FAILED", detail: delivery.status };
    }
    const sentAt =
      kind === "ORDER_CONFIRMATION"
        ? order.confirmationEmailSentAt
        : order.shippingEmailSentAt;
    if (sentAt) return { ok: false, error: "ALREADY_SENT" } as const;
    const eligibility = deliveryEligibility(kind, order);
    if (!eligibility.ok) {
      return { ok: false, error: "NOT_ELIGIBLE", detail: eligibility.reason };
    }

    const { count } = await tx.emailDelivery.updateMany({
      where: { id: delivery.id, status: "FAILED" },
      data: {
        status: "PENDING",
        attempts: 0,
        nextAttemptAt: now,
        lockedUntil: null,
        outcomeUnknownSince: null,
        lastError: null,
        updatedAt: now,
      },
    });
    if (count !== 1) {
      return { ok: false, error: "NOT_FAILED", detail: "changed" } as const;
    }
    await tx.auditLog.create({
      data: {
        adminUserId: actorId,
        action: REQUEUE_EMAIL_AUDIT_ACTION,
        entityType: "Order",
        entityId: order.id,
        metadata: {
          kind,
          deliveryId: delivery.id,
          previousAttempts: delivery.attempts,
          previousError: delivery.lastError,
        },
      },
    });
    return { ok: true, orderId: order.id, deliveryId: delivery.id } as const;
  });
}
