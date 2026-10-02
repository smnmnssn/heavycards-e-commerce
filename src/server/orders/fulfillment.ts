import {
  Prisma,
  type AdminRole,
  type FulfillmentStatus,
  type PaymentStatus,
  type PrismaClient,
  type ShippingCarrier,
} from "@/generated/prisma/client";
import { canManageOrders, ForbiddenError } from "@/lib/auth/authorization";
import { fulfillmentTransitionSchema } from "@/lib/validation/orders";
import { withTransactionRetry } from "@/server/db/transactions";
import {
  canTransitionFulfillment,
  fulfillmentAllowedForPayment,
} from "@/server/domain/fulfillment";
import type { ReviewLinkKey } from "@/server/domain/review-token";
import { enqueueOrderEmail } from "@/server/email/outbox";
import { createReviewInvitation } from "@/server/reviews/invitations";

/*
 * The single way to change an order's fulfillment status (PROJECT.md §39,
 * §55). Admin UI (Milestone 12) calls this service; it never writes
 * `fulfillmentStatus` itself.
 *
 * In one transaction, with the order row locked:
 * - the acting administrator is re-checked (active, may manage orders);
 * - the transition must be allowed (src/server/domain/fulfillment.ts) and
 *   the payment must permit it;
 * - the status changes and an UPDATE_ORDER_STATUS audit entry is written;
 * - the first transition to SHIPPED also sets `shippedAt`, creates the
 *   order's review invitation (Milestone 11) and records the shipping-email
 *   obligation (the outbox sends it after the commit, with the review link).
 *   Invitation and obligation commit together, so an email can never refer
 *   to a link that does not exist.
 *
 * Re-saving the current status is a no-op, so repeated or concurrent "mark
 * shipped" submissions never create a second email; on a SHIPPED order it
 * may only correct the tracking details. The email is never sent here: its
 * delivery cannot decide whether the transition succeeds. After a
 * successful call, pass `emailDeliveryIds` to the outbox (or let the
 * scheduled run pick them up).
 */

export const ORDER_AUDIT_ACTIONS = {
  statusUpdated: "UPDATE_ORDER_STATUS",
  trackingUpdated: "UPDATE_ORDER_TRACKING",
} as const;

export type TransitionResult =
  | {
      ok: true;
      /** False when the order already had this status (nothing changed). */
      changed: boolean;
      from: FulfillmentStatus;
      to: FulfillmentStatus;
      /** Email obligations created by this transition, to dispatch now. */
      emailDeliveryIds: string[];
    }
  | {
      ok: false;
      error: "INVALID_INPUT";
      fieldErrors: Partial<Record<string, string>>;
    }
  | { ok: false; error: "NOT_FOUND" }
  | {
      ok: false;
      error: "INVALID_TRANSITION";
      from: FulfillmentStatus;
      to: FulfillmentStatus;
    }
  | { ok: false; error: "PAYMENT_NOT_SETTLED"; paymentStatus: PaymentStatus };

type LockedOrder = {
  id: string;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  shippedAt: Date | null;
  trackingNumber: string | null;
  shippingCarrier: ShippingCarrier | null;
};

type Tx = Prisma.TransactionClient;

/**
 * Changes an order's fulfillment status. `input` is untrusted (form data).
 * Throws ForbiddenError when the actor may not manage orders.
 * `reviewLinkKey` derives the review invitation's token
 * (`reviewLinkKey` in src/server/reviews/server.ts).
 */
export async function transitionFulfillment(
  db: PrismaClient,
  {
    actorId,
    input,
    reviewLinkKey,
    now = new Date(),
  }: {
    actorId: string;
    input: unknown;
    reviewLinkKey: ReviewLinkKey;
    now?: Date;
  },
): Promise<TransitionResult> {
  const parsed = fulfillmentTransitionSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<string, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "input");
      fieldErrors[field] ??= issue.message;
    }
    return { ok: false, error: "INVALID_INPUT", fieldErrors };
  }
  const { orderId, to, trackingNumber, shippingCarrier } = parsed.data;

  return withTransactionRetry(() =>
    db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
        await assertOrderManager(tx, actorId);

        const [order] = await tx.$queryRaw<LockedOrder[]>`
          SELECT id::text AS id,
                 payment_status::text AS "paymentStatus",
                 fulfillment_status::text AS "fulfillmentStatus",
                 shipped_at AS "shippedAt",
                 tracking_number AS "trackingNumber",
                 shipping_carrier::text AS "shippingCarrier"
          FROM orders WHERE id = ${orderId}::uuid
          FOR UPDATE`;
        if (!order) return { ok: false, error: "NOT_FOUND" } as const;
        const from = order.fulfillmentStatus;

        if (from === to) {
          const changed =
            to === "SHIPPED" &&
            (await correctTracking(tx, actorId, order, {
              trackingNumber,
              shippingCarrier,
            }));
          return { ok: true, changed, from, to, emailDeliveryIds: [] };
        }
        if (!canTransitionFulfillment(from, to)) {
          return { ok: false, error: "INVALID_TRANSITION", from, to } as const;
        }
        if (!fulfillmentAllowedForPayment(to, order.paymentStatus)) {
          return {
            ok: false,
            error: "PAYMENT_NOT_SETTLED",
            paymentStatus: order.paymentStatus,
          } as const;
        }

        const shipping =
          to === "SHIPPED"
            ? {
                shippedAt: order.shippedAt ?? now,
                trackingNumber:
                  trackingNumber === undefined
                    ? order.trackingNumber
                    : trackingNumber,
                shippingCarrier: shippingCarrier ?? order.shippingCarrier,
              }
            : null;
        await tx.order.update({
          where: { id: order.id },
          data: { fulfillmentStatus: to, ...shipping },
        });
        await tx.auditLog.create({
          data: {
            adminUserId: actorId,
            action: ORDER_AUDIT_ACTIONS.statusUpdated,
            entityType: "Order",
            entityId: order.id,
            metadata: {
              from,
              to,
              ...(shipping && {
                trackingNumber: shipping.trackingNumber,
                shippingCarrier: shipping.shippingCarrier,
              }),
            },
          },
        });

        const emailDeliveryIds: string[] = [];
        if (to === "SHIPPED") {
          // SHIPPED is reachable once and the order row is locked, so this
          // is the first shipment: the only place an invitation is created.
          // Orders shipped before Milestone 11 never get one.
          await createReviewInvitation(tx, {
            orderId: order.id,
            reviewLinkKey,
            now,
          });
          emailDeliveryIds.push(
            await enqueueOrderEmail(tx, order.id, "ORDER_SHIPPED", now),
          );
        }
        return { ok: true, changed: true, from, to, emailDeliveryIds };
      },
      { maxWait: 10_000, timeout: 20_000 },
    ),
  );
}

/** Updates tracking details on an already shipped order; never emails. */
async function correctTracking(
  tx: Tx,
  actorId: string,
  order: LockedOrder,
  input: {
    trackingNumber: string | null | undefined;
    shippingCarrier: ShippingCarrier | undefined;
  },
): Promise<boolean> {
  const trackingNumber =
    input.trackingNumber === undefined
      ? order.trackingNumber
      : input.trackingNumber;
  const shippingCarrier = input.shippingCarrier ?? order.shippingCarrier;
  if (
    trackingNumber === order.trackingNumber &&
    shippingCarrier === order.shippingCarrier
  ) {
    return false;
  }
  await tx.order.update({
    where: { id: order.id },
    data: { trackingNumber, shippingCarrier },
  });
  await tx.auditLog.create({
    data: {
      adminUserId: actorId,
      action: ORDER_AUDIT_ACTIONS.trackingUpdated,
      entityType: "Order",
      entityId: order.id,
      metadata: {
        from: {
          trackingNumber: order.trackingNumber,
          shippingCarrier: order.shippingCarrier,
        },
        to: { trackingNumber, shippingCarrier },
      },
    },
  });
  return true;
}

/**
 * Re-checks the acting administrator inside the transaction, like the
 * catalog services: a deactivation between the session check and this
 * write is caught, and FOR SHARE keeps it from committing concurrently.
 */
async function assertOrderManager(tx: Tx, actorId: string) {
  const [actor] = await tx.$queryRaw<
    Array<{ role: AdminRole; isActive: boolean }>
  >`
    SELECT role::text AS role, is_active AS "isActive"
    FROM admin_users WHERE id = ${actorId}::uuid
    FOR SHARE`;
  if (!actor?.isActive || !canManageOrders(actor)) {
    throw new ForbiddenError("Behörighet saknas för beställningar.");
  }
}
