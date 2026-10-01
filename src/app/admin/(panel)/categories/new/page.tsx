import type { Metadata } from "next";

import {
  AdminPageHeader,
  CatalogForbidden,
} from "@/components/admin/catalog/page-header";
import { TaxonomyForm } from "@/components/admin/catalog/taxonomy-form";
import { canManageCatalog } from "@/lib/auth/authorization";
import { requireAdmin } from "@/lib/auth/session";
import { env } from "@/lib/env/server";
import { EMPTY_CATEGORY_FORM } from "@/server/admin/catalog/form-values";

export const metadata: Metadata = { title: "Ny kategori" };

export default async function NewCategoryPage() {
  const admin = await requireAdmin();
  if (!canManageCatalog(admin)) return <CatalogForbidden />;

  return (
    <div className="grid gap-8">
      <AdminPageHeader
        eyebrow="Katalog"
        title="Ny kategori"
        back={{ href: "/admin/categories", label: "Alla kategorier" }}
      />
      <TaxonomyForm
        kind="category"
        initialValues={EMPTY_CATEGORY_FORM}
        siteUrl={env.siteUrl}
      />
    </div>
  );
}
