import type { Metadata } from "next";
import Link from "next/link";

import { ForbiddenPanel } from "@/components/admin/forbidden-panel";
import { AttentionBadge } from "@/components/admin/orders/order-badges";
import {
  ORDER_ROW_COLUMNS,
  OrderRow,
} from "@/components/admin/orders/order-row";
import { ROLE_LABELS } from "@/components/admin/roles";
import { canManageOrders } from "@/lib/auth/authorization";
import { requireAdmin } from "@/lib/auth/session";
import { formatInstantDate, formatInstantDateTime } from "@/lib/dates";
import { db } from "@/lib/db/client";
import { formatSek } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  getAdminDashboard,
  SALES_WINDOW_DAYS,
  type AdminDashboard,
} from "@/server/admin/dashboard";
import {
  describeAttention,
  describeOrderEvent,
  publicOrderNumber,
} from "@/server/admin/orders/presenters";
import { getPublicStoreInfo } from "@/server/data/store-settings";

export const metadata: Metadata = { title: "Översikt" };

export default async function AdminDashboardPage() {
  const admin = await requireAdmin();
  if (!canManageOrders(admin)) {
    return (
      <ForbiddenPanel message="Ditt konto har inte behörighet till översikten." />
    );
  }
  const now = new Date();
  const { lowStockThreshold } = await getPublicStoreInfo();
  const dashboard = await getAdminDashboard(db, {
    actorId: admin.id,
    lowStockThreshold,
    now,
  });

  return (
    <div className="grid gap-10">
      <div>
        <p className="type-eyebrow text-muted-foreground">Översikt</p>
        <h1 className="mt-3 type-h1">Hej {admin.name}</h1>
        <p className="mt-4 max-w-2xl text-muted-foreground">
          Inloggad som {ROLE_LABELS[admin.role].toLowerCase()}. Sessionen gäller
          till {formatInstantDateTime(admin.sessionExpiresAt)}.
        </p>
      </div>

      <AttentionSection attention={dashboard.attention} />

      <section aria-labelledby="att-gora">
        <h2 id="att-gora" className="type-h3">
          Att göra
        </h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            href="/admin/orders?betalning=betalda&leverans=NEW"
            label="Nya beställningar"
            value={dashboard.orders.toStart}
            text="Betalda, inte påbörjade"
            highlight={dashboard.orders.toStart > 0}
          />
          <Tile
            href="/admin/orders?betalning=betalda&leverans=PROCESSING"
            label="Under behandling"
            value={dashboard.orders.processing}
            text="Betalda, väntar på att skickas"
            highlight={dashboard.orders.processing > 0}
          />
          <Tile
            href="/admin/reviews"
            label="Recensioner att granska"
            value={dashboard.pendingReviews}
            text="Visas inte förrän de godkänts"
            highlight={dashboard.pendingReviews > 0}
          />
          <Tile
            href="/admin/products?status=publicerade&lager=lagt"
            label="Lågt lager"
            value={dashboard.lowStock.total}
            text={`Publicerade, högst ${lowStockThreshold} st kvar`}
            highlight={dashboard.lowStock.total > 0}
          />
          {dashboard.orders.refundedOpen > 0 && (
            <Tile
              href="/admin/orders?betalning=REFUNDED&leverans=att-hantera"
              label="Återbetalda, ej avslutade"
              value={dashboard.orders.refundedOpen}
              text="Helt återbetalda före leverans – avbryt dem"
              highlight
            />
          )}
          {(dashboard.emails.retrying > 0 || dashboard.emails.overdue > 0) && (
            <Tile
              label="E-post i kö"
              value={Math.max(
                dashboard.emails.retrying,
                dashboard.emails.overdue,
              )}
              text={
                dashboard.emails.overdue > 0
                  ? "Väntar på nästa schemalagda körning"
                  : "Försöker igen automatiskt"
              }
            />
          )}
        </ul>
      </section>

      <SalesSection sales={dashboard.sales} />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section aria-labelledby="senaste-bestallningar" className="grid gap-4">
          <div className="flex items-end justify-between gap-4">
            <h2 id="senaste-bestallningar" className="type-h3">
              Senaste beställningar
            </h2>
            <Link
              href="/admin/orders"
              className="text-sm font-semibold underline underline-offset-4"
            >
              Alla beställningar
            </Link>
          </div>
          {dashboard.recentOrders.length === 0 ? (
            <p className="rounded-lg border border-border bg-background p-6 text-muted-foreground">
              Inga beställningar ännu.
            </p>
          ) : (
            <ul className="grid gap-px overflow-hidden rounded-lg border border-border bg-border">
              <li
                aria-hidden="true"
                className={cn(
                  "hidden bg-muted px-5 py-3 text-xs font-semibold tracking-wide uppercase lg:grid lg:gap-4",
                  ORDER_ROW_COLUMNS,
                )}
              >
                <span>Order</span>
                <span>Kund</span>
                <span>Betalning</span>
                <span>Leverans</span>
                <span className="text-right">Belopp</span>
              </li>
              {dashboard.recentOrders.map((row) => (
                <OrderRow key={row.id} row={row} />
              ))}
            </ul>
          )}
        </section>

        <div className="grid content-start gap-10">
          <LowStockSection lowStock={dashboard.lowStock} />
          <EventsSection events={dashboard.recentEvents} />
        </div>
      </div>
    </div>
  );
}

function Tile({
  href,
  label,
  value,
  text,
  highlight = false,
}: {
  /** Without a link the tile is informational only. */
  href?: string;
  label: string;
  value: number;
  text: string;
  highlight?: boolean;
}) {
  const className = cn(
    "block h-full rounded-lg border bg-background p-5",
    href && "transition-colors hover:border-foreground",
    highlight ? "border-foreground" : "border-border",
  );
  const content = (
    <>
      <span className="block text-sm font-semibold">{label}</span>
      <span className="mt-2 block text-3xl font-semibold tabular-nums">
        {value}
      </span>
      <span className="mt-1 block text-sm text-muted-foreground">{text}</span>
    </>
  );
  return (
    <li data-testid="dashboard-tile">
      {href ? (
        <Link href={href} className={className}>
          {content}
        </Link>
      ) : (
        <div className={className}>{content}</div>
      )}
    </li>
  );
}

function AttentionSection({
  attention,
}: {
  attention: AdminDashboard["attention"];
}) {
  if (attention.orders === 0) {
    return (
      <p
        className="rounded-lg border border-border bg-background p-5 text-sm"
        data-testid="dashboard-attention"
      >
        Inga betalnings-, e-post- eller lagerproblem kräver åtgärd just nu.
      </p>
    );
  }
  const parts = [
    attention.payment > 0 && `${attention.payment} betalning`,
    attention.email > 0 && `${attention.email} e-post`,
    attention.stock > 0 && `${attention.stock} lager`,
  ].filter(Boolean);
  return (
    <section
      aria-labelledby="dashboard-kraver-atgard"
      data-testid="dashboard-attention"
      className="rounded-lg border border-destructive bg-background p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="dashboard-kraver-atgard" className="type-h3">
          Kräver åtgärd
        </h2>
        <AttentionBadge>
          {`${attention.orders} ${attention.orders === 1 ? "beställning" : "beställningar"}`}
        </AttentionBadge>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Problem som systemet har stoppat och sparat i stället för att gissa (
        {parts.join(", ")}).
      </p>
      <ul className="mt-4 grid gap-3">
        {attention.latest.map((item) => (
          <li key={item.id} className="text-sm">
            <Link
              href={`/admin/orders/${item.orderId}`}
              className="font-semibold underline underline-offset-4"
            >
              {publicOrderNumber(item.orderNumber)}
            </Link>
            {": "}
            {describeAttention(item.action, item.metadata).title}{" "}
            <span className="text-xs text-muted-foreground">
              ({formatInstantDateTime(item.createdAt)})
            </span>
          </li>
        ))}
      </ul>
      <Link
        href="/admin/orders?atgard=1"
        className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4"
      >
        Visa alla som kräver åtgärd
      </Link>
    </section>
  );
}

function SalesSection({ sales }: { sales: AdminDashboard["sales"] }) {
  const figures: Array<[string, string]> = [
    ["Betalda beställningar", String(sales.orders)],
    ["Betalt", formatSek(sales.grossAmount)],
    ["Återbetalt", formatSek(sales.refundedAmount)],
    ["Netto", formatSek(sales.netAmount)],
  ];
  return (
    <section aria-labelledby="forsaljning">
      <h2 id="forsaljning" className="type-h3">
        Försäljning senaste {SALES_WINDOW_DAYS} dagarna
      </h2>
      <dl className="mt-4 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
        {figures.map(([label, value]) => (
          <div key={label} className="bg-background p-5">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">
        Beställningar med betalningstid från {formatInstantDate(sales.since)}{" "}
        som är betalda, delvis återbetalda eller återbetalda. Belopp inklusive
        moms och frakt; netto drar av det som hittills återbetalats på dem.
        Väntande, misslyckade och avbrutna kassor räknas inte.
      </p>
    </section>
  );
}

function LowStockSection({
  lowStock,
}: {
  lowStock: AdminDashboard["lowStock"];
}) {
  return (
    <section aria-labelledby="dashboard-lagt-lager" className="grid gap-4">
      <h2 id="dashboard-lagt-lager" className="type-h3">
        Lågt lager
      </h2>
      {lowStock.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Inga publicerade produkter har lågt lager.
        </p>
      ) : (
        <ul className="grid gap-2 text-sm">
          {lowStock.rows.map((row) => (
            <li key={row.id} className="flex justify-between gap-4">
              <Link
                href={`/admin/products/${row.id}`}
                className="min-w-0 break-words underline-offset-4 hover:underline"
              >
                {row.name}
              </Link>
              <span className="shrink-0 tabular-nums">
                {row.availableQuantity === 0
                  ? "Slut"
                  : `${row.availableQuantity} st`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EventsSection({ events }: { events: AdminDashboard["recentEvents"] }) {
  return (
    <section aria-labelledby="senaste-handelser" className="grid gap-4">
      <h2 id="senaste-handelser" className="type-h3">
        Senaste orderhändelser
      </h2>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">Inga händelser ännu.</p>
      ) : (
        <ol className="grid gap-3 text-sm">
          {events.map((event) => (
            <li key={event.id} className="border-l-2 border-border pl-4">
              {event.orderNumber !== null && (
                <Link
                  href={`/admin/orders/${event.orderId}`}
                  className="font-semibold underline underline-offset-4"
                >
                  {publicOrderNumber(event.orderNumber)}
                </Link>
              )}{" "}
              {describeOrderEvent(event.action, event.metadata)}
              <span className="block text-xs text-muted-foreground">
                {formatInstantDateTime(event.createdAt)} ·{" "}
                {event.actorName ?? "System"}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
