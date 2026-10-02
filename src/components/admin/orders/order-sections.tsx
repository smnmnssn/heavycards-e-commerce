import Link from "next/link";
import type { ReactNode } from "react";

import { resolveAttentionAction } from "@/app/admin/(panel)/orders/actions";
import { AdminRowAction } from "@/components/admin/admin-row-action";
import type { EmailKind } from "@/generated/prisma/enums";
import { formatInstantDateTime } from "@/lib/dates";
import { formatSek } from "@/lib/money";
import { cn } from "@/lib/utils";
import type {
  AdminOrderDetail,
  AdminOrderEvent,
} from "@/server/admin/orders/queries";
import {
  describeAttention,
  describeOrderEvent,
  EMAIL_KIND_LABELS,
} from "@/server/admin/orders/presenters";

import { attentionBlocksStock } from "@/server/admin/orders/attention";

import { AttentionBadge, EmailStatusBadge } from "./order-badges";
import { RecheckPayment } from "./recheck-payment";

/*
 * Server-rendered sections of /admin/orders/[id]. Everything shown comes
 * from the order and its snapshots; amounts are formatted from öre.
 */

export function Card({
  id,
  title,
  children,
  className,
}: {
  id: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "rounded-lg border border-border bg-background p-5 sm:p-6",
        className,
      )}
    >
      <h2 id={id} className="type-h3">
        {title}
      </h2>
      <div className="mt-4 grid gap-4">{children}</div>
    </section>
  );
}

/** A label/value list; empty values are shown as a dash. */
export function Facts({
  rows,
}: {
  rows: Array<[label: string, value: ReactNode]>;
}) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value ?? "–"}</dd>
        </div>
      ))}
    </dl>
  );
}

export const when = (value: Date | null) =>
  value ? formatInstantDateTime(value) : null;

export const Mono = ({ children }: { children: ReactNode }) => (
  <code className="font-mono text-xs break-all">{children}</code>
);

// --- Needs attention ------------------------------------------------------------

export function AttentionList({ order }: { order: AdminOrderDetail }) {
  if (order.attention.length === 0) return null;
  const paymentProblem = order.attention.some(
    (item) => describeAttention(item.action, item.metadata).kind === "payment",
  );
  return (
    <section
      aria-labelledby="kraver-atgard"
      className="rounded-lg border border-destructive bg-background p-5 sm:p-6"
      data-testid="order-attention"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="kraver-atgard" className="type-h3">
          Kräver åtgärd
        </h2>
        <AttentionBadge>{`${order.attention.length} öppna`}</AttentionBadge>
      </div>
      <ul className="mt-4 grid gap-4">
        {order.attention.map((item) => {
          const description = describeAttention(item.action, item.metadata);
          const blocking = attentionBlocksStock(item.action, order);
          return (
            <li
              key={item.id}
              className="grid gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0"
            >
              <div>
                <p className="font-semibold">{description.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {description.guidance}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Registrerat {formatInstantDateTime(item.createdAt)}
                </p>
              </div>
              {blocking ? (
                <p
                  className="text-sm font-medium text-destructive"
                  data-testid="attention-blocking"
                >
                  {order.heldUnits} st i lager är reserverade för beställningen
                  tills Stripe ger ett säkert besked. Problemet kan inte
                  markeras som hanterat förrän betalningen är avgjord.
                </p>
              ) : (
                <AdminRowAction
                  action={resolveAttentionAction}
                  fields={{ orderId: order.id, attentionId: item.id }}
                  label="Markera som hanterat"
                  pendingLabel="Sparar…"
                  accessibleLabel={`Markera som hanterat: ${description.title}`}
                />
              )}
            </li>
          );
        })}
      </ul>
      {paymentProblem && (
        <div className="mt-4 grid gap-2 border-t border-border pt-4">
          <p className="text-sm text-muted-foreground">
            Hämtar betalningens aktuella läge från Stripe. Är den betald
            slutförs beställningen; har kassan gått ut eller betalningen
            misslyckats släpps lagret. Annars ändras ingenting.
          </p>
          <RecheckPayment
            orderId={order.id}
            available={
              order.paymentStatus === "PENDING" &&
              order.stripeCheckoutSessionId !== null
            }
          />
        </div>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        &rdquo;Markera som hanterat&rdquo; tar bort punkten från översikten och
        loggas. Det ändrar inte beställningen, betalningen, lagret eller
        e-posten, och går inte för ett betalningsproblem som fortfarande håller
        lager reserverat.
      </p>
    </section>
  );
}

// --- Items and totals ----------------------------------------------------------

const REVIEW_LABELS = {
  PENDING: "Recension väntar",
  APPROVED: "Recension godkänd",
  REJECTED: "Recension avvisad",
} as const;

export function ItemsCard({ order }: { order: AdminOrderDetail }) {
  const net = order.totalAmount - order.refundedAmount;
  return (
    <Card id="artiklar" title="Artiklar">
      <p className="text-sm text-muted-foreground">
        Namn, artikelnummer och priser som de var vid köpet.
      </p>
      <ul className="grid gap-px overflow-hidden rounded-md border border-border bg-border">
        {order.items.map((item) => (
          <li
            key={item.id}
            data-testid="order-item"
            className="grid gap-2 bg-background p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"
          >
            <div className="min-w-0">
              <Link
                href={`/admin/products/${item.productId}`}
                className="font-semibold break-words underline-offset-4 hover:underline"
              >
                {item.productNameSnapshot}
              </Link>
              <p className="text-xs text-muted-foreground">
                SKU {item.skuSnapshot} · moms {item.vatRateBasisPoints / 100} %
                {item.review && (
                  <>
                    {" · "}
                    <Link
                      href={`/admin/reviews?status=${item.review.status}`}
                      className="underline underline-offset-4"
                    >
                      {REVIEW_LABELS[item.review.status]} ({item.review.rating}
                      /5)
                    </Link>
                  </>
                )}
              </p>
            </div>
            <p className="text-sm tabular-nums sm:text-right">
              {item.quantity} × {formatSek(item.unitPriceAmount)}
              <span className="block font-semibold">
                {formatSek(item.totalPriceAmount)}
              </span>
            </p>
          </li>
        ))}
      </ul>
      <dl className="grid gap-1.5 text-sm tabular-nums">
        <Total label="Delsumma" amount={order.subtotalAmount} />
        <Total
          label="Frakt"
          amount={order.shippingAmount}
          text={order.shippingAmount === 0 ? "Fri frakt" : undefined}
        />
        <Total label="Totalt" amount={order.totalAmount} strong />
        <Total label="varav moms" amount={order.taxAmount} muted />
        {order.refundedAmount > 0 && (
          <>
            <Total label="Återbetalt" amount={-order.refundedAmount} />
            <Total label="Netto efter återbetalning" amount={net} strong />
          </>
        )}
      </dl>
    </Card>
  );
}

function Total({
  label,
  amount,
  text,
  strong,
  muted,
}: {
  label: string;
  amount: number;
  text?: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex justify-between gap-4",
        strong && "font-semibold",
        muted && "text-muted-foreground",
      )}
    >
      <dt>{label}</dt>
      <dd>{text ?? formatSek(amount)}</dd>
    </div>
  );
}

// --- Email -----------------------------------------------------------------------

const EMAIL_KINDS: EmailKind[] = ["ORDER_CONFIRMATION", "ORDER_SHIPPED"];

const NOT_DUE: Record<EmailKind, string> = {
  ORDER_CONFIRMATION: "Skickas när betalningen är bekräftad.",
  ORDER_SHIPPED: "Skickas när beställningen markeras som skickad.",
};

export function EmailCard({ order }: { order: AdminOrderDetail }) {
  const markers: Record<EmailKind, Date | null> = {
    ORDER_CONFIRMATION: order.confirmationEmailSentAt,
    ORDER_SHIPPED: order.shippingEmailSentAt,
  };
  return (
    <Card id="e-post" title="E-post till kunden">
      <ul className="grid gap-4">
        {EMAIL_KINDS.map((kind) => {
          const delivery = order.emails.find((email) => email.kind === kind);
          const sentMarker = markers[kind];
          return (
            <li
              key={kind}
              data-testid={`email-${kind}`}
              className="grid gap-2 border-t border-border pt-4 first:border-t-0 first:pt-0"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{EMAIL_KIND_LABELS[kind]}</p>
                {delivery && (
                  <EmailStatusBadge
                    status={delivery.status}
                    attempts={delivery.attempts}
                  />
                )}
              </div>
              {delivery ? (
                <EmailDetails delivery={delivery} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {sentMarker
                    ? `Skickat ${formatInstantDateTime(sentMarker)}.`
                    : NOT_DUE[kind]}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        Varje mejl skickas högst en gång per beställning. Det finns ingen
        manuell omsändning; kontakta kunden direkt om ett mejl inte kom fram.
      </p>
    </Card>
  );
}

function EmailDetails({
  delivery,
}: {
  delivery: AdminOrderDetail["emails"][number];
}) {
  const rows: Array<[string, ReactNode]> = [];
  if (delivery.sentAt) rows.push(["Skickat", when(delivery.sentAt)]);
  rows.push(["Försök", String(delivery.attempts)]);
  if (delivery.status === "PENDING") {
    rows.push(["Nästa försök", when(delivery.nextAttemptAt)]);
  } else if (delivery.lastAttemptAt && !delivery.sentAt) {
    rows.push(["Senaste försök", when(delivery.lastAttemptAt)]);
  }
  if (delivery.lastError && delivery.status !== "SENT") {
    rows.push(["Felkod", <Mono key="error">{delivery.lastError}</Mono>]);
  }
  if (delivery.providerMessageId) {
    rows.push([
      "Resend-ID",
      <Mono key="resend">{delivery.providerMessageId}</Mono>,
    ]);
  }
  return <Facts rows={rows} />;
}

// --- Timeline --------------------------------------------------------------------

export function TimelineCard({ events }: { events: AdminOrderEvent[] }) {
  return (
    <Card id="historik" title="Historik">
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Inga registrerade händelser ännu.
        </p>
      ) : (
        <ol className="grid gap-3" data-testid="order-timeline">
          {events.map((event) => (
            <li
              key={event.id}
              className="grid gap-1 border-l-2 border-border pl-4 text-sm"
            >
              <p>{describeOrderEvent(event.action, event.metadata)}</p>
              <p className="text-xs text-muted-foreground">
                {formatInstantDateTime(event.createdAt)} ·{" "}
                {event.actorName ?? "System"}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
