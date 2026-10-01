import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DangerAction } from "@/components/admin/catalog/danger-action";
import { FormSection } from "@/components/admin/catalog/form-layout";
import {
  PRODUCT_STATUS_BADGES,
  PRODUCT_STATUS_LABELS,
} from "@/components/admin/catalog/labels";
import {
  AdminPageHeader,
  CatalogForbidden,
} from "@/components/admin/catalog/page-header";
import { ProductForm } from "@/components/admin/catalog/product-form";
import { ProductImagesManager } from "@/components/admin/catalog/product-images-manager";
import { FormAlert } from "@/components/admin/form-alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { canManageCatalog } from "@/lib/auth/authorization";
import { requireAdmin } from "@/lib/auth/session";
import { productPath } from "@/lib/catalog-paths";
import { stockholmToday } from "@/lib/dates";
import { db } from "@/lib/db/client";
import { env } from "@/lib/env/server";
import { productFormValues } from "@/server/admin/catalog/form-values";
import {
  catalogOptions,
  getAdminProduct,
} from "@/server/admin/catalog/queries";
import { UUID_PATTERN } from "@/server/admin/catalog/shared";
import { hasPublicPage } from "@/server/domain/catalog";
import { productWarnings } from "@/server/domain/catalog-admin";

import { deleteProductAction } from "../actions";

export const metadata: Metadata = { title: "Redigera produkt" };

const dateTime = new Intl.DateTimeFormat("sv-SE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Stockholm",
});

export default async function EditProductPage({
  params,
  searchParams,
}: PageProps<"/admin/products/[id]">) {
  const admin = await requireAdmin();
  if (!canManageCatalog(admin)) return <CatalogForbidden />;

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const now = new Date();
  const [product, options, query] = await Promise.all([
    getAdminProduct(db, id, now),
    catalogOptions(db),
    searchParams,
  ]);
  if (!product) notFound();

  const today = stockholmToday(now);
  const warnings = productWarnings(
    {
      status: product.status,
      isPreorder: product.isPreorder,
      releaseDate: product.releaseDate,
      imageCount: product.images.length,
      availableQuantity: Math.max(
        0,
        product.stockOnHand - product.reservedQuantity,
      ),
    },
    today,
  );
  const { orderItems, reservations, reviews } = product.history;
  const deletable =
    product.publishedAt === null && orderItems + reservations + reviews === 0;

  return (
    <div className="grid gap-8">
      <AdminPageHeader
        eyebrow="Produkt"
        title={product.name}
        back={{ href: "/admin/products", label: "Alla produkter" }}
        actions={
          hasPublicPage(product, now) && (
            <ButtonLink
              href={productPath(product.slug)}
              variant="secondary"
              target="_blank"
            >
              Visa i butiken
            </ButtonLink>
          )
        }
      >
        <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
          <Badge
            variant={PRODUCT_STATUS_BADGES[product.status]}
            data-testid="product-status"
          >
            {PRODUCT_STATUS_LABELS[product.status]}
          </Badge>
          <span>SKU {product.sku}</span>
          <span>
            {product.publishedAt
              ? `Först publicerad ${dateTime.format(product.publishedAt)}`
              : "Aldrig publicerad"}
          </span>
          <span>Senast ändrad {dateTime.format(product.updatedAt)}</span>
        </p>
        {query.skapad === "1" && (
          <FormAlert tone="success">
            Produkten är skapad. Ladda upp bilder och publicera när den är klar.
          </FormAlert>
        )}
        {warnings.length > 0 && (
          <FormAlert tone="info">
            <ul className="grid gap-1" data-testid="product-warnings">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </FormAlert>
        )}
      </AdminPageHeader>

      <ProductForm
        mode="edit"
        productId={product.id}
        siteUrl={env.siteUrl}
        today={today}
        categories={options.categories}
        sets={options.sets}
        initialValues={productFormValues(product)}
        stockOnHand={product.stockOnHand}
        reservedQuantity={product.reservedQuantity}
        wasPublished={product.publishedAt !== null}
        imagesSection={
          <ProductImagesManager
            productId={product.id}
            productName={product.name}
            images={product.images}
          />
        }
      />

      <FormSection
        id="historik"
        title="Historik och radering"
        description={`Orderrader: ${orderItems} · Reservationer: ${reservations} · Recensioner: ${reviews}`}
      >
        {deletable ? (
          <>
            <p className="text-sm text-muted-foreground">
              Produkten har aldrig varit publicerad och saknar historik, så den
              kan raderas permanent. Det går inte att ångra.
            </p>
            <DangerAction
              action={deleteProductAction.bind(null, product.id)}
              label="Radera produkt"
              pendingLabel="Raderar…"
              confirmMessage={`Radera ${product.name} permanent? Det går inte att ångra.`}
            />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Produkten kan inte raderas eftersom den{" "}
            {product.publishedAt
              ? "har varit publicerad (adressen kan vara länkad eller indexerad)"
              : "har ordrar, reservationer eller recensioner"}
            . Välj status <strong>Arkiverad</strong> ovan för att sluta sälja
            den; orderhistorik och gamla länkar bevaras.
          </p>
        )}
      </FormSection>
    </div>
  );
}
