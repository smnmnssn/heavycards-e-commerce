import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import {
  PRODUCT_STATUS_BADGES,
  PRODUCT_STATUS_LABELS,
} from "@/components/admin/catalog/labels";
import {
  AdminPageHeader,
  CatalogForbidden,
} from "@/components/admin/catalog/page-header";
import { FormAlert } from "@/components/admin/form-alert";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/form";
import { canManageCatalog } from "@/lib/auth/authorization";
import { requireAdmin } from "@/lib/auth/session";
import { formatIsoDate, stockholmToday, type IsoDate } from "@/lib/dates";
import { db } from "@/lib/db/client";
import { formatSek } from "@/lib/money";
import {
  ADMIN_SORTS,
  ADMIN_STATUS_FILTERS,
  ADMIN_STOCK_FILTERS,
  adminProductsHref,
  parseAdminProductParams,
} from "@/server/admin/catalog/product-list-params";
import {
  catalogOptions,
  listAdminProducts,
  type AdminProductRow,
} from "@/server/admin/catalog/queries";
import { getPublicStoreInfo } from "@/server/data/store-settings";
import {
  isPreorderPastRelease,
  stockLevel,
} from "@/server/domain/catalog-admin";

export const metadata: Metadata = { title: "Produkter" };

export default async function AdminProductsPage({
  searchParams,
}: PageProps<"/admin/products">) {
  const admin = await requireAdmin();
  if (!canManageCatalog(admin)) return <CatalogForbidden />;

  const query = await searchParams;
  const params = parseAdminProductParams(query);
  const now = new Date();
  const today = stockholmToday(now);
  const { lowStockThreshold } = await getPublicStoreInfo();
  const [list, lowStock, options] = await Promise.all([
    listAdminProducts(db, { params, lowStockThreshold, now }),
    listAdminProducts(db, {
      params: {
        ...params,
        q: "",
        status: "publicerade",
        categoryId: "",
        setId: "",
        stock: "lagt",
        page: 1,
      },
      lowStockThreshold,
      now,
      pageSize: 1,
    }),
    catalogOptions(db),
  ]);
  const filtered =
    params.q ||
    params.status ||
    params.categoryId ||
    params.setId ||
    params.stock;

  return (
    <div className="grid gap-8">
      <AdminPageHeader
        eyebrow="Katalog"
        title="Produkter"
        actions={<ButtonLink href="/admin/products/new">Ny produkt</ButtonLink>}
      >
        {query.raderad === "1" && (
          <FormAlert tone="success">Produkten är raderad.</FormAlert>
        )}
        {lowStock.total > 0 && params.stock !== "lagt" && (
          <FormAlert tone="info">
            <strong>{lowStock.total}</strong> publicerade{" "}
            {lowStock.total === 1 ? "produkt har" : "produkter har"} lågt lager
            (högst {lowStockThreshold} st tillgängligt).{" "}
            <Link
              href={adminProductsHref(params, {
                status: "publicerade",
                stock: "lagt",
                page: 1,
              })}
              className="font-semibold underline underline-offset-4"
            >
              Visa dem
            </Link>
          </FormAlert>
        )}
      </AdminPageHeader>

      <form
        role="search"
        aria-label="Filtrera produkter"
        className="grid gap-4 rounded-lg border border-border bg-background p-5 sm:grid-cols-2 lg:grid-cols-6 lg:items-end"
      >
        <div className="grid gap-2 sm:col-span-2 lg:col-span-2">
          <Label htmlFor="produkter-q">Sök</Label>
          <Input
            id="produkter-q"
            name="q"
            type="search"
            defaultValue={params.q}
            placeholder="Namn, SKU eller slug"
            maxLength={100}
          />
        </div>
        <FilterSelect
          id="produkter-status"
          name="status"
          label="Status"
          value={params.status}
          options={Object.entries(ADMIN_STATUS_FILTERS)}
        />
        <FilterSelect
          id="produkter-kategori"
          name="kategori"
          label="Kategori"
          value={params.categoryId}
          options={[
            ["", "Alla kategorier"],
            ...options.categories.map(
              (c) => [c.id, c.name] as [string, string],
            ),
          ]}
        />
        <FilterSelect
          id="produkter-set"
          name="set"
          label="Pokémon-set"
          value={params.setId}
          options={[
            ["", "Alla set"],
            ...options.sets.map((s) => [s.id, s.name] as [string, string]),
          ]}
        />
        <FilterSelect
          id="produkter-lager"
          name="lager"
          label="Lager"
          value={params.stock}
          options={Object.entries(ADMIN_STOCK_FILTERS)}
        />
        <FilterSelect
          id="produkter-sortering"
          name="sortering"
          label="Sortering"
          value={params.sort}
          options={Object.entries(ADMIN_SORTS)}
        />
        <div className="flex gap-3 sm:col-span-2 lg:col-span-5 lg:justify-end">
          <Button type="submit">Filtrera</Button>
          {filtered && (
            <ButtonLink href="/admin/products" variant="secondary">
              Rensa
            </ButtonLink>
          )}
        </div>
      </form>

      <section aria-labelledby="produktlista" className="grid gap-4">
        <h2 id="produktlista" className="text-sm text-muted-foreground">
          {list.total} {list.total === 1 ? "produkt" : "produkter"}
          {list.pageCount > 1 && ` · sida ${list.page} av ${list.pageCount}`}
        </h2>
        {list.rows.length === 0 ? (
          <p className="rounded-lg border border-border bg-background p-8 text-center text-muted-foreground">
            {filtered
              ? "Inga produkter matchar filtret."
              : "Inga produkter ännu. Skapa den första med Ny produkt."}
          </p>
        ) : (
          <ul className="grid gap-px overflow-hidden rounded-lg border border-border bg-border">
            <li
              aria-hidden="true"
              className="hidden bg-muted px-5 py-3 text-xs font-semibold tracking-wide uppercase lg:grid lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1.3fr)_minmax(0,1.1fr)] lg:gap-4"
            >
              <span>Produkt</span>
              <span>Pris</span>
              <span>Lager</span>
              <span>Status</span>
              <span>Kategori / set</span>
              <span>Släpp</span>
            </li>
            {list.rows.map((row) => (
              <ProductRow
                key={row.id}
                row={row}
                today={today}
                lowStockThreshold={lowStockThreshold}
              />
            ))}
          </ul>
        )}
        {list.pageCount > 1 && (
          <nav aria-label="Sidor" className="flex justify-between gap-3">
            {list.page > 1 ? (
              <ButtonLink
                variant="secondary"
                href={adminProductsHref(params, { page: list.page - 1 })}
              >
                Föregående
              </ButtonLink>
            ) : (
              <span />
            )}
            {list.page < list.pageCount && (
              <ButtonLink
                variant="secondary"
                href={adminProductsHref(params, { page: list.page + 1 })}
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

const cellLabel = "text-xs text-muted-foreground lg:sr-only";

function ProductRow({
  row,
  today,
  lowStockThreshold,
}: {
  row: AdminProductRow;
  today: IsoDate;
  lowStockThreshold: number;
}) {
  const level = stockLevel(row.availableQuantity, lowStockThreshold);
  const pastRelease = isPreorderPastRelease(row, today);
  return (
    <li
      data-testid="admin-product-row"
      className="grid grid-cols-2 gap-x-4 gap-y-3 bg-background px-5 py-4 sm:grid-cols-3 lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1.3fr)_minmax(0,1.1fr)] lg:items-center"
    >
      <div className="col-span-2 flex min-w-0 items-center gap-3 sm:col-span-3 lg:col-span-1">
        <div className="size-12 shrink-0 overflow-hidden rounded-sm bg-surface">
          {row.imageUrl && (
            <Image
              src={row.imageUrl}
              alt=""
              width={48}
              height={48}
              sizes="48px"
              className="size-full object-contain"
            />
          )}
        </div>
        <div className="min-w-0">
          <Link
            href={`/admin/products/${row.id}`}
            className="font-semibold break-words underline-offset-4 hover:underline"
          >
            {row.name}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {row.sku}
            {row.isFeatured && " · Utvald"}
          </p>
        </div>
      </div>

      <div>
        <p className={cellLabel}>Pris</p>
        <p className="text-sm tabular-nums">
          {formatSek(row.priceAmount)}
          {row.compareAtPriceAmount !== null && (
            <span className="block text-xs text-muted-foreground line-through">
              {formatSek(row.compareAtPriceAmount)}
            </span>
          )}
        </p>
      </div>

      <div>
        <p className={cellLabel}>Lager</p>
        <p className="text-sm tabular-nums">
          {row.availableQuantity} st tillgängligt
          {row.reservedQuantity > 0 && (
            <span className="block text-xs text-muted-foreground">
              {row.stockOnHand} i lager, {row.reservedQuantity} reserverat
            </span>
          )}
        </p>
        {level !== "ok" && (
          <Badge
            variant={level === "out" ? "solid" : "outline"}
            className="mt-1"
          >
            {level === "out" ? "Slut" : "Lågt lager"}
          </Badge>
        )}
      </div>

      <div>
        <p className={cellLabel}>Status</p>
        <Badge variant={PRODUCT_STATUS_BADGES[row.status]}>
          {PRODUCT_STATUS_LABELS[row.status]}
        </Badge>
      </div>

      <div className="min-w-0 text-sm">
        <p className={cellLabel}>Kategori / set</p>
        <p className="break-words">{row.categoryName}</p>
        {row.setName && (
          <p className="text-xs break-words text-muted-foreground">
            {row.setName}
          </p>
        )}
      </div>

      <div className="text-sm">
        <p className={cellLabel}>Släpp</p>
        {row.isPreorder && <Badge variant="outline">Förbeställning</Badge>}
        {row.releaseDate ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {formatIsoDate(row.releaseDate)}
          </p>
        ) : (
          !row.isPreorder && <p className="text-muted-foreground">–</p>
        )}
        {pastRelease && (
          <p className="mt-1 text-xs font-semibold text-destructive">
            Släppdatum passerat
          </p>
        )}
      </div>
    </li>
  );
}
