import type { Metadata } from "next";

import { AdminPageHeader } from "@/components/admin/catalog/page-header";
import { ForbiddenPanel } from "@/components/admin/forbidden-panel";
import {
  ORDER_ROW_COLUMNS,
  OrderRow,
} from "@/components/admin/orders/order-row";
import { Button, ButtonLink } from "@/components/ui/button";
import { Checkbox, Input, Label, Select } from "@/components/ui/form";
import { canManageOrders } from "@/lib/auth/authorization";
import { requireAdmin } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { cn } from "@/lib/utils";
import {
  adminOrdersHref,
  ORDER_FULFILLMENT_FILTERS,
  ORDER_PAYMENT_FILTERS,
  ORDER_SORTS,
  parseAdminOrderParams,
} from "@/server/admin/orders/list-params";
import { listAdminOrders } from "@/server/admin/orders/queries";

export const metadata: Metadata = { title: "Beställningar" };

export default async function AdminOrdersPage({
  searchParams,
}: PageProps<"/admin/orders">) {
  const admin = await requireAdmin();
  if (!canManageOrders(admin)) {
    return (
      <ForbiddenPanel message="Ditt konto har inte behörighet att hantera beställningar." />
    );
  }

  const params = parseAdminOrderParams(await searchParams);
  const list = await listAdminOrders(db, { actorId: admin.id, params });
  const filtered = Boolean(
    params.q ||
    params.payment ||
    params.fulfillment ||
    params.attention ||
    params.from ||
    params.to,
  );

  return (
    <div className="grid gap-8">
      <AdminPageHeader eyebrow="Försäljning" title="Beställningar">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Sök på ordernummer (HC-10001), kundens namn eller e-post, eller ett
          Stripe-ID. Listan visar bara namn; öppna en beställning för kontakt-
          och leveransuppgifter.
        </p>
      </AdminPageHeader>

      <form
        role="search"
        aria-label="Filtrera beställningar"
        className="grid gap-4 rounded-lg border border-border bg-background p-5 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
      >
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="ordrar-q">Sök</Label>
          <Input
            id="ordrar-q"
            name="q"
            type="search"
            defaultValue={params.q}
            placeholder="HC-10001, namn, e-post eller Stripe-ID"
            maxLength={100}
          />
        </div>
        <FilterSelect
          id="ordrar-betalning"
          name="betalning"
          label="Betalning"
          value={params.payment}
          options={Object.entries(ORDER_PAYMENT_FILTERS)}
        />
        <FilterSelect
          id="ordrar-leverans"
          name="leverans"
          label="Leverans"
          value={params.fulfillment}
          options={Object.entries(ORDER_FULFILLMENT_FILTERS)}
        />
        <div className="grid gap-2">
          <Label htmlFor="ordrar-fran">Lagd från</Label>
          <Input
            id="ordrar-fran"
            name="fran"
            type="date"
            defaultValue={params.from}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ordrar-till">Lagd till och med</Label>
          <Input
            id="ordrar-till"
            name="till"
            type="date"
            defaultValue={params.to}
          />
        </div>
        <FilterSelect
          id="ordrar-sortering"
          name="sortering"
          label="Sortering"
          value={params.sort}
          options={Object.entries(ORDER_SORTS)}
        />
        <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
          <Checkbox name="atgard" value="1" defaultChecked={params.attention} />
          Bara de som kräver åtgärd
        </label>
        <div className="flex gap-3 sm:col-span-2 lg:col-span-4 lg:justify-end">
          <Button type="submit">Filtrera</Button>
          {filtered && (
            <ButtonLink href="/admin/orders" variant="secondary">
              Rensa
            </ButtonLink>
          )}
        </div>
      </form>

      <section aria-labelledby="orderlista" className="grid gap-4">
        <h2 id="orderlista" className="text-sm text-muted-foreground">
          {list.total} {list.total === 1 ? "beställning" : "beställningar"}
          {list.pageCount > 1 && ` · sida ${list.page} av ${list.pageCount}`}
        </h2>
        {list.rows.length === 0 ? (
          <p className="rounded-lg border border-border bg-background p-8 text-center text-muted-foreground">
            {filtered
              ? "Inga beställningar matchar filtret."
              : "Inga beställningar ännu."}
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
            {list.rows.map((row) => (
              <OrderRow key={row.id} row={row} />
            ))}
          </ul>
        )}
        {list.pageCount > 1 && (
          <nav aria-label="Sidor" className="flex justify-between gap-3">
            {list.page > 1 ? (
              <ButtonLink
                variant="secondary"
                href={adminOrdersHref(params, { page: list.page - 1 })}
              >
                Föregående
              </ButtonLink>
            ) : (
              <span />
            )}
            {list.page < list.pageCount && (
              <ButtonLink
                variant="secondary"
                href={adminOrdersHref(params, { page: list.page + 1 })}
              >
                Nästa
              </ButtonLink>
            )}
          </nav>
        )}
      </section>
    </div>
  );
}

function FilterSelect({
  id,
  name,
  label,
  value,
  options,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  options: Array<[string, string]>;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select id={id} name={name} defaultValue={value}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </Select>
    </div>
  );
}
