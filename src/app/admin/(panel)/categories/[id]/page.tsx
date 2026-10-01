import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  AdminPageHeader,
  CatalogForbidden,
} from "@/components/admin/catalog/page-header";
import { TaxonomyForm } from "@/components/admin/catalog/taxonomy-form";
import { TaxonomyDeleteSection } from "@/components/admin/catalog/taxonomy-pages";
import { FormAlert } from "@/components/admin/form-alert";
import { ButtonLink } from "@/components/ui/button";
import { canManageCatalog } from "@/lib/auth/authorization";
import { requireAdmin } from "@/lib/auth/session";
import { categoryPath } from "@/lib/catalog-paths";
import { db } from "@/lib/db/client";
import { env } from "@/lib/env/server";
import { categoryFormValues } from "@/server/admin/catalog/form-values";
import { getAdminCategory } from "@/server/admin/catalog/queries";
import { UUID_PATTERN } from "@/server/admin/catalog/shared";

import { deleteCategoryAction } from "../actions";

export const metadata: Metadata = { title: "Redigera kategori" };

export default async function EditCategoryPage({
  params,
  searchParams,
}: PageProps<"/admin/categories/[id]">) {
  const admin = await requireAdmin();
  if (!canManageCatalog(admin)) return <CatalogForbidden />;

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const [category, query] = await Promise.all([
    getAdminCategory(db, id),
    searchParams,
  ]);
  if (!category) notFound();

  return (
    <div className="grid gap-8">
      <AdminPageHeader
        eyebrow="Kategori"
        title={category.name}
        back={{ href: "/admin/categories", label: "Alla kategorier" }}
        actions={
          <ButtonLink
            href={categoryPath(category.slug)}
            variant="secondary"
            target="_blank"
          >
            Visa i butiken
          </ButtonLink>
        }
      >
        {query.skapad === "1" && (
          <FormAlert tone="success">Kategorin är skapad.</FormAlert>
        )}
      </AdminPageHeader>
      <TaxonomyForm
        kind="category"
        id={category.id}
        initialValues={categoryFormValues(category)}
        siteUrl={env.siteUrl}
      />
      <TaxonomyDeleteSection
        noun="kategorin"
        name={category.name}
        productCount={category.productCount}
        productsHref={`/admin/products?status=alla&kategori=${category.id}`}
        publicUrl={categoryPath(category.slug)}
        deleteAction={deleteCategoryAction.bind(null, category.id)}
      />
    </div>
  );
}
