import type { Metadata } from "next";

import { AdminPageHeader } from "@/components/admin/catalog/page-header";
import { ForbiddenPanel } from "@/components/admin/forbidden-panel";
import { FulfillmentPanel } from "@/components/admin/orders/fulfillment-panel";
import {
  AttentionBadge,
  FulfillmentBadge,
  PaymentBadge,
} from "@/components/admin/orders/order-badges";
import {
  AttentionList,
  Card,
  EmailCard,
  Facts,
  ItemsCard,
  Mono,
  TimelineCard,
  when,
} from "@/components/admin/orders/order-sections";
import type { FulfillmentStatus } from "@/generated/prisma/enums";
import { canManageOrders } from "@/lib/auth/authorization";
import { ADMIN_ORDERS_PATH } from "@/lib/auth/routes";
import { requireAdmin } from "@/lib/auth/session";
import { formatInstantDateTime } from "@/lib/dates";
import { db } from "@/lib/db/client";
import { env } from "@/lib/env/server";
import { formatSek } from "@/lib/money";
import { UUID_PATTERN } from "@/server/admin/catalog/shared";
import {
  CARRIER_LABELS,
  FULFILLMENT_STATUS_LABELS,
  publicOrderNumber,
} from "@/server/admin/orders/presenters";
import {
  getAdminOrder,
  type AdminOrderDetail,
} from "@/server/admin/orders/queries";
import {
  stripeDashboardIsLive,
  stripePaymentUrl,
} from "@/server/admin/orders/stripe-links";
import {
  allowedFulfillmentTransitions,
  fulfillmentAllowedForPayment,
} from "@/server/domain/fulfillment";

export const metadata: Metadata = { title: "Beställning" };

const BACK = { href: ADMIN_ORDERS_PATH, label: "Beställningar" };

export default async function AdminOrderPage({
  params,
}: PageProps<"/admin/orders/[id]">) {
  const admin = await requireAdmin();
  if (!canManageOrders(admin)) {
    return (
      <ForbiddenPanel message="Ditt konto har inte behörighet att hantera beställningar." />
    );
  }

  const { id } = await params;
  const order = UUID_PATTERN.test(id)
    ? await getAdminOrder(db, {
        actorId: admin.id,
        orderId: id,
        now: new Date(),
      })
    : null;
  if (!order) {
    return (
      <div className="grid gap-6">
        <AdminPageHeader
          eyebrow="Beställning"
          title="Beställningen finns inte"
          back={BACK}
        />
        <p className="text-muted-foreground">
          Länken kan vara fel, eller så har beställningen aldrig funnits.
        </p>
      </div>
    );
  }

  // What the domain allows now: the transition table and the payment rule.
  const targets = allowedFulfillmentTransitions(order.fulfillmentStatus)
    .filter((to) => fulfillmentAllowedForPayment(to, order.paymentStatus))
    .filter((to): to is Exclude<FulfillmentStatus, "NEW"> => to !== "NEW");

  return (
    <div className="grid gap-8">
      <AdminPageHeader
        eyebrow="Beställning"
        title={publicOrderNumber(order.orderNumber)}
        back={BACK}
      >
        <p className="flex flex-wrap items-center gap-2">
          <PaymentBadge status={order.paymentStatus} />
          <FulfillmentBadge status={order.fulfillmentStatus} />
          {order.attention.length > 0 && <AttentionBadge />}
          <span className="text-sm text-muted-foreground">
            Lagd {formatInstantDateTime(order.createdAt)}
          </span>
        </p>
      </AdminPageHeader>

      <AttentionList order={order} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
        <div className="grid gap-6">
          <Card id="leverans" title="Leverans">
            <Facts
              rows={[
                ["Status", FULFILLMENT_STATUS_LABELS[order.fulfillmentStatus]],
                ["Skickad", when(order.shippedAt)],
                [
                  "Fraktbolag",
                  order.shippingCarrier
                    ? CARRIER_LABELS[order.shippingCarrier]
                    : null,
                ],
                ["Spårningsnummer", order.trackingNumber],
              ]}
            />
            {targets.length === 0 && order.fulfillmentStatus !== "SHIPPED" && (
              <FulfillmentNote order={order} />
            )}
            {/* Always mounted, so its last result stays visible after the
                page refreshes into a final status. */}
            <FulfillmentPanel
              orderId={order.id}
              status={order.fulfillmentStatus}
              targets={targets}
              carrier={order.shippingCarrier ?? "POSTNORD"}
              trackingNumber={order.trackingNumber}
            />
          </Card>
          <ItemsCard order={order} />
          <TimelineCard events={order.events} />
        </div>

        <div className="grid gap-6">
          <CustomerCard order={order} />
          <PaymentCard order={order} />
          <EmailCard order={order} />
          <ReviewInvitationCard order={order} />
        </div>
      </div>
    </div>
  );
}

function FulfillmentNote({ order }: { order: AdminOrderDetail }) {
  const text =
    order.fulfillmentStatus === "COMPLETED"
      ? "Beställningen är slutförd."
      : order.fulfillmentStatus === "CANCELLED"
        ? "Beställningen är avbruten."
        : "Beställningen är inte betald och kan inte hanteras. Den stängs automatiskt om kassan går ut.";
  return <p className="text-sm text-muted-foreground">{text}</p>;
}

function CustomerCard({ order }: { order: AdminOrderDetail }) {
  if (!order.customerName && !order.email) {
    return (
      <Card id="kund" title="Kund">
        <p className="text-sm text-muted-foreground">
          Kunduppgifterna kommer från Stripe när betalningen är klar.
        </p>
      </Card>
    );
  }
  return (
    <Card id="kund" title="Kund">
      <Facts
        rows={[
          ["Namn", order.customerName],
          [
            "E-post",
            order.email && (
              <a
                href={`mailto:${order.email}`}
                className="underline underline-offset-4"
              >
                {order.email}
              </a>
            ),
          ],
          [
            "Telefon",
            order.phone && (
              <a
                href={`tel:${order.phone}`}
                className="underline underline-offset-4"
              >
                {order.phone}
              </a>
            ),
          ],
          [
            "Leveransadress",
            order.addressLine1 && (
              <address className="not-italic">
                {order.addressLine1}
                {order.addressLine2 && (
                  <>
                    <br />
                    {order.addressLine2}
                  </>
                )}
                <br />
                {order.postalCode} {order.city}
                <br />
                {order.country === "SE" ? "Sverige" : order.country}
              </address>
            ),
          ],
        ]}
      />
    </Card>
  );
}

function PaymentCard({ order }: { order: AdminOrderDetail }) {
  const stripeUrl = stripePaymentUrl(
    order.stripePaymentIntentId,
    stripeDashboardIsLive(env.payments),
  );
  const refunded =
    order.paymentStatus === "REFUNDED" ||
    order.paymentStatus === "PARTIALLY_REFUNDED";
  return (
    <Card id="betalning" title="Betalning">
      <Facts
        rows={[
          ["Status", <PaymentBadge key="s" status={order.paymentStatus} />],
          ["Betald", when(order.paidAt)],
          ["Totalt", formatSek(order.totalAmount)],
          ["Återbetalt", formatSek(order.refundedAmount)],
          ...(order.paymentStatus === "PENDING"
            ? ([
                ["Kassan stängs", when(order.checkoutExpiresAt)],
                [
                  "Reserverat lager",
                  order.heldUnits > 0 ? `${order.heldUnits} st` : "Inget",
                ],
              ] as Array<[string, string | null]>)
            : []),
          [
            "Checkout Session",
            order.stripeCheckoutSessionId && (
              <Mono>{order.stripeCheckoutSessionId}</Mono>
            ),
          ],
          [
            "PaymentIntent",
            order.stripePaymentIntentId && (
              <Mono>{order.stripePaymentIntentId}</Mono>
            ),
          ],
        ]}
      />
      {stripeUrl && (
        <a
          href={stripeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="w-fit text-sm font-semibold underline underline-offset-4"
        >
          Öppna betalningen i Stripe Dashboard
          <span className="sr-only"> (öppnas i en ny flik)</span>
        </a>
      )}
      <p
        className="text-sm text-muted-foreground"
        data-testid="refund-explanation"
      >
        Återbetalningar görs i Stripe Dashboard och synkas hit automatiskt.
        {refunded &&
          " Lagret ändras inte vid återbetalning; justera lagersaldot under Produkter om en returnerad vara kan säljas igen."}
      </p>
    </Card>
  );
}

function ReviewInvitationCard({ order }: { order: AdminOrderDetail }) {
  const invitation = order.reviewInvitation;
  return (
    <Card id="recensionslank" title="Recensionslänk">
      {invitation ? (
        <Facts
          rows={[
            ["Skapad", when(invitation.createdAt)],
            [
              "Gäller till",
              invitation.revokedAt
                ? `Återkallad ${formatInstantDateTime(invitation.revokedAt)}`
                : when(invitation.expiresAt),
            ],
          ]}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Skapas när beställningen markeras som skickad och skickas med
          leveransbeskedet.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Själva länken visas aldrig i admin; bara kunden har den.
      </p>
    </Card>
  );
}
