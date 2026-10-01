import type { Metadata } from "next";

import { CatalogForbidden } from "@/components/admin/catalog/page-header";
import { TaxonomyListPage } from "@/components/admin/catalog/taxonomy-pages";
import { canManageCatalog } from "@/lib/auth/authorization";
import { requireAdmin } from "@/lib/auth/session";
import { categoryPath } from "@/lib/catalog-paths";
import { db } from "@/lib/db/client";
import { listAdminCategories } from "@/server/admin/catalog/queries";

export const metadata: Metadata = { title: "Kategorier" };

export default async function AdminCategoriesPage({
  searchParams,
}: PageProps<"/admin/categories">) {
  const admin = await requireAdmin();
  if (!canManageCatalog(admin)) return <CatalogForbidden />;

  const [rows, query] = await Promise.all([
    listAdminCategories(db),
    searchParams,
  ]);
  return (
    <TaxonomyListPage
      title="Kategorier"
      basePath="/admin/categories"
      publicPath={categoryPath}
      newLabel="Ny kategori"
      rows={rows}
      deleted={query.raderad === "1"}
      emptyText="Inga kategorier ännu."
      detailColumn="sortOrder"
    />
  );
}
