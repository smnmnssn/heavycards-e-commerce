import type { Metadata } from "next";

import { CatalogForbidden } from "@/components/admin/catalog/page-header";
import { TaxonomyListPage } from "@/components/admin/catalog/taxonomy-pages";
import { canManageCatalog } from "@/lib/auth/authorization";
import { requireAdmin } from "@/lib/auth/session";
import { setPath } from "@/lib/catalog-paths";
import { db } from "@/lib/db/client";
import { listAdminSets } from "@/server/admin/catalog/queries";

export const metadata: Metadata = { title: "Pokémon-set" };

export default async function AdminSetsPage({
  searchParams,
}: PageProps<"/admin/sets">) {
  const admin = await requireAdmin();
  if (!canManageCatalog(admin)) return <CatalogForbidden />;

  const [rows, query] = await Promise.all([listAdminSets(db), searchParams]);
  return (
    <TaxonomyListPage
      title="Pokémon-set"
      basePath="/admin/sets"
      publicPath={setPath}
      newLabel="Nytt set"
      rows={rows}
      deleted={query.raderad === "1"}
      emptyText="Inga Pokémon-set ännu."
      detailColumn="releaseDate"
    />
  );
}
