import type { Metadata } from "next";
import Link from "next/link";

import {
  AdminPageHeader,
  CatalogForbidden,
} from "@/components/admin/catalog/page-header";
import { ProductForm } from "@/components/admin/catalog/product-form";
import { FormAlert } from "@/components/admin/form-alert";
import { canManageCatalog } from "@/lib/auth/authorization";
import { requireAdmin } from "@/lib/auth/session";
import { stockholmToday } from "@/lib/dates";
import { db } from "@/lib/db/client";
import { env } from "@/lib/env/server";
import { EMPTY_PRODUCT_FORM } from "@/server/admin/catalog/form-values";
import { catalogOptions } from "@/server/admin/catalog/queries";

export const metadata: Metadata = { title: "Ny produkt" };

export default async function NewProductPage() {
  const admin = await requireAdmin();
  if (!canManageCatalog(admin)) return <CatalogForbidden />;

  const options = await catalogOptions(db);

  return (
    <div className="grid gap-8">
      <AdminPageHeader
        eyebrow="Katalog"
        title="Ny produkt"
        back={{ href: "/admin/products", label: "Alla produkter" }}
      >
        <p className="max-w-2xl text-muted-foreground">
          Nya produkter sparas som utkast tills du väljer en publicerad status.
        </p>
      </AdminPageHeader>
      {options.categories.length === 0 ? (
        <FormAlert tone="info">
          Skapa en{" "}
          <Link
            href="/admin/categories/new"
            className="font-semibold underline underline-offset-4"
          >
            kategori
          </Link>{" "}
          först; varje produkt måste tillhöra en kategori.
        </FormAlert>
      ) : (
        <ProductForm
          mode="create"
          siteUrl={env.siteUrl}
          today={stockholmToday(new Date())}
          categories={options.categories}
          sets={options.sets}
          initialValues={{
            ...EMPTY_PRODUCT_FORM,
            categoryId: options.categories[0]!.id,
          }}
          imagesSection={
            <p className="text-sm text-muted-foreground">
              Spara produkten först. Därefter kan du ladda upp bilder här.
            </p>
          }
        />
      )}
    </div>
  );
}
